-- Enforce Neulifi's one-photo-per-scan product rule in stored meal history and persistence.

update public.meals
set image_urls = case
  when jsonb_typeof(image_urls) = 'array' and jsonb_array_length(image_urls) > 0 then jsonb_build_array(image_urls->0)
  else '[]'::jsonb
end
where jsonb_typeof(image_urls) <> 'array'
   or jsonb_array_length(image_urls) > 1;

alter table public.meals
drop constraint if exists meals_image_urls_array_check;

alter table public.meals
add constraint meals_image_urls_array_check
check (jsonb_typeof(image_urls) = 'array' and jsonb_array_length(image_urls) <= 1);

create or replace function public.persist_meal_analysis(
  p_user_id uuid,
  p_event_key text,
  p_image_url text,
  p_meal_name text,
  p_captured_at timestamptz,
  p_provider text,
  p_analysis jsonb,
  p_image_urls jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_meal_id uuid;
  saved_meal_id uuid;
  supplied_images jsonb := coalesce(p_image_urls, '[]'::jsonb);
  normalized_images jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_user_id is null or p_event_key is null or length(trim(p_event_key)) = 0 then
    raise exception 'Meal event is incomplete';
  end if;
  if jsonb_typeof(supplied_images) = 'array' and jsonb_array_length(supplied_images) > 1 then
    raise exception 'Only one meal photo is allowed per scan';
  end if;

  normalized_images := case
    when nullif(trim(coalesce(p_image_url, '')), '') is not null then jsonb_build_array(trim(p_image_url))
    when jsonb_typeof(supplied_images) = 'array' and jsonb_array_length(supplied_images) = 1 then jsonb_build_array(supplied_images->0)
    else '[]'::jsonb
  end;

  select meal_id into existing_meal_id
  from public.meal_ingest_events
  where event_key = p_event_key
  limit 1;
  if existing_meal_id is not null then
    return existing_meal_id;
  end if;

  insert into public.meals (user_id, image_url, image_urls, meal_name, status, captured_at)
  values (p_user_id, normalized_images->>0, normalized_images, left(coalesce(p_meal_name, 'Meal'), 120), 'analysed', coalesce(p_captured_at, now()))
  returning id into saved_meal_id;

  insert into public.meal_analyses (meal_id, rating, score, indicators, explanation, recommendations, meal_guidance, daily_tasks)
  values (
    saved_meal_id,
    coalesce(p_analysis->>'rating', 'Reasonable'),
    greatest(0, least(100, coalesce((p_analysis->>'score')::integer, 60))),
    coalesce(p_analysis->'indicators', '{}'::jsonb),
    coalesce(p_analysis->>'explanation', ''),
    coalesce(p_analysis->'mealGuidance', p_analysis->'recommendations', '[]'::jsonb),
    coalesce(p_analysis->'mealGuidance', p_analysis->'recommendations', '[]'::jsonb),
    coalesce(p_analysis->'dailyTasks', '[]'::jsonb)
  );

  insert into public.meal_ingest_events (event_key, user_id, meal_id)
  values (p_event_key, p_user_id, saved_meal_id);

  perform public.record_activity_internal(p_user_id, 'meal_scan', saved_meal_id::text);
  perform public.record_referral_scan(p_user_id, 'scan:' || saved_meal_id::text);
  return saved_meal_id;
end;
$$;

revoke all on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
