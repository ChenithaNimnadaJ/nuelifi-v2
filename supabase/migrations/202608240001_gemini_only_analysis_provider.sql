-- Remove the legacy provider from persisted meal-analysis writes.
-- Existing meal rows remain unchanged; new writes must come from the Gemini-only Worker.
create or replace function public.persist_meal_analysis(
  p_user_id uuid,
  p_event_key text,
  p_image_url text,
  p_meal_name text,
  p_captured_at timestamptz,
  p_provider text,
  p_analysis jsonb,
  p_image_urls jsonb default '[]'::jsonb
) returns uuid
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
  if p_user_id is null or p_event_key is null or p_event_key !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'Meal event is incomplete';
  end if;
  if p_provider <> 'gemini' then
    raise exception 'Meal analysis provider is not verified';
  end if;
  if nullif(btrim(p_image_url), '') is null then
    raise exception 'Meal image is required';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' or pg_column_size(p_analysis) > 200000 then
    raise exception 'Meal analysis is invalid or too large';
  end if;
  if nullif(btrim(p_analysis->>'rating'), '') is null
     or (p_analysis->>'score') !~ '^-?[0-9]+([.][0-9]+)?$'
     or jsonb_typeof(coalesce(p_analysis->'mealGuidance', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_analysis->'dailyTasks', '[]'::jsonb)) <> 'array' then
    raise exception 'Meal analysis is incomplete';
  end if;
  if jsonb_typeof(supplied_images) <> 'array' or jsonb_array_length(supplied_images) > 1 then
    raise exception 'Only one meal photo is allowed per scan';
  end if;

  select meal_id into existing_meal_id
    from public.meal_ingest_events
   where event_key = p_event_key and user_id = p_user_id
   limit 1;
  if existing_meal_id is not null then return existing_meal_id; end if;
  if exists (select 1 from public.meal_ingest_events where event_key = p_event_key) then
    raise exception 'Meal event key is already used';
  end if;

  normalized_images := jsonb_build_array(btrim(p_image_url));
  insert into public.meals (user_id, image_url, image_urls, meal_name, status, captured_at)
  values (p_user_id, normalized_images->>0, normalized_images, left(coalesce(nullif(btrim(p_meal_name), ''), 'Meal'), 120), 'analysed', coalesce(p_captured_at, now()))
  returning id into saved_meal_id;

  insert into public.meal_analyses (meal_id, rating, score, indicators, explanation, recommendations, meal_guidance, daily_tasks)
  values (
    saved_meal_id,
    left(coalesce(p_analysis->>'rating', 'Reasonable'), 40),
    greatest(0, least(100, coalesce((p_analysis->>'score')::integer, 60))),
    case when jsonb_typeof(p_analysis->'indicators') = 'object' then p_analysis->'indicators' else '{}'::jsonb end,
    left(coalesce(p_analysis->>'explanation', ''), 4000),
    case when jsonb_typeof(p_analysis->'mealGuidance') = 'array' then p_analysis->'mealGuidance' else '[]'::jsonb end,
    case when jsonb_typeof(p_analysis->'mealGuidance') = 'array' then p_analysis->'mealGuidance' else '[]'::jsonb end,
    case when jsonb_typeof(p_analysis->'dailyTasks') = 'array' then p_analysis->'dailyTasks' else '[]'::jsonb end
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
