-- SQL-backed dashboard analytics. Macro values are stored in meal_analyses.indicators
-- using the persisted keys protein, carbohydrates, fats, and fibre.
create or replace function public.get_user_analytics(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with profile_timezone as (
  select case
    when exists (
      select 1 from pg_timezone_names
      where name = coalesce(nullif(p.timezone, ''), nullif(p.preferences ->> 'timezone', ''), 'UTC')
    ) then coalesce(nullif(p.timezone, ''), nullif(p.preferences ->> 'timezone', ''), 'UTC')
    else 'UTC'
  end as timezone
  from public.profiles p
  where p.id = p_user_id
  limit 1
), base as (
  select
    m.user_id,
    m.id as meal_id,
    m.captured_at,
    ma.score,
    case
      when extract(hour from (m.captured_at at time zone coalesce((select timezone from profile_timezone), 'UTC'))) between 5 and 10 then 'Morning'
      when extract(hour from (m.captured_at at time zone coalesce((select timezone from profile_timezone), 'UTC'))) between 11 and 15 then 'Afternoon'
      when extract(hour from (m.captured_at at time zone coalesce((select timezone from profile_timezone), 'UTC'))) between 16 and 21 then 'Evening'
      else 'Late Night'
    end as time_window,
    case when ma.indicators ->> 'protein' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (ma.indicators ->> 'protein')::numeric end as protein_g,
    case when ma.indicators ->> 'carbohydrates' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (ma.indicators ->> 'carbohydrates')::numeric end as carbs_g,
    case when ma.indicators ->> 'fats' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (ma.indicators ->> 'fats')::numeric end as fat_g,
    case when ma.indicators ->> 'fibre' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (ma.indicators ->> 'fibre')::numeric end as fiber_g
  from public.meals m
  join public.meal_analyses ma on ma.meal_id = m.id
  where m.user_id = p_user_id
    and m.status = 'analysed'
), ordered_scores as (
  select
    b.*,
    avg(b.score) over (
      partition by b.user_id
      order by b.captured_at, b.meal_id
      rows between 6 preceding and current row
    ) as rolling_average,
    row_number() over (partition by b.user_id order by b.captured_at desc, b.meal_id desc) as reverse_row
  from base b
), chart_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'capturedAt', o.captured_at,
        'label', to_char(o.captured_at at time zone coalesce((select timezone from profile_timezone), 'UTC'), 'Mon DD'),
        'score', o.score,
        'rollingAverage', round(o.rolling_average::numeric, 2)
      ) order by o.captured_at, o.meal_id
    ) filter (where o.reverse_row <= 30),
    '[]'::jsonb
  ) as series
  from ordered_scores o
), bucket_names(name, sort_order) as (
  values ('Morning', 1), ('Afternoon', 2), ('Evening', 3), ('Late Night', 4)
), bucket_stats as (
  select
    n.name,
    n.sort_order,
    round(avg(b.score)::numeric, 2) as average_score,
    count(b.meal_id) as meal_count
  from bucket_names n
  left join base b on b.time_window = n.name
  group by n.name, n.sort_order
), heatmap_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'window', s.name,
        'averageScore', s.average_score,
        'mealCount', s.meal_count
      ) order by s.sort_order
    ),
    '[]'::jsonb
  ) as buckets
  from bucket_stats s
), ranked_deciles as (
  select
    b.*,
    ntile(10) over (partition by b.user_id order by b.score desc, b.captured_at, b.meal_id) as decile,
    count(*) over (partition by b.user_id) as sample_count
  from base b
), ranked_with_bounds as (
  select r.*
  from ranked_deciles r
), blueprint_json as (
  select jsonb_build_object(
    'top', jsonb_build_object(
      'proteinG', avg(r.protein_g) filter (where r.decile = 1 and r.sample_count >= 2),
      'carbsG', avg(r.carbs_g) filter (where r.decile = 1 and r.sample_count >= 2),
      'fatG', avg(r.fat_g) filter (where r.decile = 1 and r.sample_count >= 2),
      'fiberG', avg(r.fiber_g) filter (where r.decile = 1 and r.sample_count >= 2),
      'sampleCount', count(*) filter (where r.decile = 1 and r.sample_count >= 2)
    ),
    'bottom', jsonb_build_object(
      'proteinG', avg(r.protein_g) filter (where r.decile = 10 and r.sample_count >= 2),
      'carbsG', avg(r.carbs_g) filter (where r.decile = 10 and r.sample_count >= 2),
      'fatG', avg(r.fat_g) filter (where r.decile = 10 and r.sample_count >= 2),
      'fiberG', avg(r.fiber_g) filter (where r.decile = 10 and r.sample_count >= 2),
      'sampleCount', count(*) filter (where r.decile = 10 and r.sample_count >= 2)
    ),
    'sampleCount', count(*)
  ) as blueprint
  from ranked_with_bounds r
), with_previous_meal as (
  select
    b.*,
    extract(epoch from (b.captured_at - lag(b.captured_at) over (partition by b.user_id order by b.captured_at, b.meal_id))) / 3600.0 as gap_hours
  from base b
), interval_json as (
  select jsonb_build_object(
    'longGap', jsonb_build_object(
      'averageScore', avg(w.score) filter (where w.gap_hours > 6),
      'mealCount', count(*) filter (where w.gap_hours > 6)
    ),
    'shortGap', jsonb_build_object(
      'averageScore', avg(w.score) filter (where w.gap_hours <= 6),
      'mealCount', count(*) filter (where w.gap_hours <= 6)
    )
  ) as interval_penalty
  from with_previous_meal w
  where w.gap_hours is not null
), volatility_rows as (
  select
    b.*,
    stddev_samp(b.score) over (
      partition by b.user_id
      order by b.captured_at
      range between interval '13 days' preceding and current row
    ) as score_stddev,
    stddev_samp(b.protein_g) over (
      partition by b.user_id
      order by b.captured_at
      range between interval '13 days' preceding and current row
    ) as protein_stddev,
    row_number() over (partition by b.user_id order by b.captured_at desc, b.meal_id desc) as reverse_row
  from base b
), volatility_json as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'capturedAt', v.captured_at,
          'label', to_char(v.captured_at at time zone coalesce((select timezone from profile_timezone), 'UTC'), 'Mon DD'),
          'scoreStddev', v.score_stddev,
          'proteinStddev', v.protein_stddev
        ) order by v.captured_at, v.meal_id
      ) filter (where v.reverse_row <= 30),
      '[]'::jsonb
    ) as series,
    (
      select jsonb_build_object('scoreStddev', v.score_stddev, 'proteinStddev', v.protein_stddev)
      from volatility_rows v
      where v.reverse_row = 1
      limit 1
    ) as latest
  from volatility_rows v
)
select jsonb_build_object(
  'chart', jsonb_build_object(
    'series', (select series from chart_json),
    'target', jsonb_build_object('min', 70, 'max', 100)
  ),
  'performanceHeatmap', jsonb_build_object('buckets', (select buckets from heatmap_json)),
  'optimalBlueprint', coalesce((select blueprint from blueprint_json), jsonb_build_object(
    'top', jsonb_build_object('proteinG', null, 'carbsG', null, 'fatG', null, 'fiberG', null, 'sampleCount', 0),
    'bottom', jsonb_build_object('proteinG', null, 'carbsG', null, 'fatG', null, 'fiberG', null, 'sampleCount', 0),
    'sampleCount', 0
  )),
  'intervalPenalty', coalesce((select interval_penalty from interval_json), jsonb_build_object(
    'longGap', jsonb_build_object('averageScore', null, 'mealCount', 0),
    'shortGap', jsonb_build_object('averageScore', null, 'mealCount', 0)
  )),
  'nutrientVolatility', jsonb_build_object(
    'series', (select series from volatility_json),
    'latest', coalesce((select latest from volatility_json), jsonb_build_object('scoreStddev', null, 'proteinStddev', null))
  )
);
$$;

revoke all on function public.get_user_analytics(uuid) from public, anon, authenticated;
grant execute on function public.get_user_analytics(uuid) to service_role;

create index if not exists meal_analyses_score_meal_idx on public.meal_analyses (score, meal_id);
