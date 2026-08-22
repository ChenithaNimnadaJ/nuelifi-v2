drop policy if exists meals_owner on public.meals;
create policy meals_owner_read on public.meals for select using ((select auth.uid()) = user_id);
drop policy if exists meal_analyses_owner on public.meal_analyses;
create policy meal_analyses_owner_read on public.meal_analyses for select using (exists (select 1 from public.meals where meals.id = meal_analyses.meal_id and meals.user_id = (select auth.uid())));
revoke insert, update, delete on public.meals from anon, authenticated;
revoke insert, update, delete on public.meal_analyses from anon, authenticated;

 drop policy if exists actions_owner on public.actions;
create policy actions_owner_read on public.actions for select using ((select auth.uid()) = user_id);
create policy actions_owner_insert on public.actions for insert with check ((select auth.uid()) = user_id);
create policy actions_owner_delete on public.actions for delete using ((select auth.uid()) = user_id);
revoke update on public.actions from anon, authenticated;

create or replace function public.protect_action_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.completed := false;
    new.completed_at := null;
  elsif current_setting('neulifi.internal_action_update', true) <> 'on' and new.completed is distinct from old.completed then
    new.completed := old.completed;
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists actions_protect_completion on public.actions;
create trigger actions_protect_completion before insert or update on public.actions for each row execute function public.protect_action_completion();

create or replace function public.complete_action(p_action_id uuid, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from public.actions where id = p_action_id for update;
  if owner_id is null or auth.uid() is null or owner_id <> auth.uid() then raise exception 'Task not found'; end if;
  perform set_config('neulifi.internal_action_update', 'on', true);
  update public.actions set completed = p_completed, completed_at = case when p_completed then now() else null end where id = p_action_id;
  perform set_config('neulifi.internal_action_update', 'off', true);
  if p_completed then perform public.record_activity_internal(owner_id, 'task_completion', p_action_id::text); end if;
end;
$$;

create or replace function public.record_activity_internal(p_user_id uuid, p_activity_type text, p_activity_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  user_zone text;
  activity_date_local date;
  previous_date date;
  next_current integer;
  next_longest integer;
  existing_streak public.streaks%rowtype;
begin
  select coalesce(nullif(timezone, ''), 'UTC') into user_zone from public.profiles where id = p_user_id;
  begin
    activity_date_local := (timezone(coalesce(user_zone, 'UTC'), now()))::date;
  exception when others then
    activity_date_local := (timezone('UTC', now()))::date;
  end;
  insert into public.user_activity_days (user_id, activity_date, sources)
  values (p_user_id, activity_date_local, jsonb_build_array(jsonb_build_object('type', p_activity_type, 'key', p_activity_key)))
  on conflict (user_id, activity_date) do update
    set sources = case
      when public.user_activity_days.sources @> jsonb_build_array(jsonb_build_object('type', p_activity_type, 'key', p_activity_key))
        then public.user_activity_days.sources
      else public.user_activity_days.sources || jsonb_build_array(jsonb_build_object('type', p_activity_type, 'key', p_activity_key))
    end;

  select * into existing_streak from public.streaks where user_id = p_user_id for update;
  if not found then
    next_current := 1;
    next_longest := 1;
  elsif existing_streak.last_activity_date = activity_date_local then
    next_current := existing_streak.current_streak;
    next_longest := existing_streak.longest_streak;
  else
    previous_date := activity_date_local - 1;
    next_current := case when existing_streak.last_activity_date = previous_date then existing_streak.current_streak + 1 else 1 end;
    next_longest := greatest(existing_streak.longest_streak, next_current);
  end if;

  insert into public.streaks (user_id, current_streak, longest_streak, last_activity_date)
  values (p_user_id, next_current, next_longest, activity_date_local)
  on conflict (user_id) do update set current_streak = excluded.current_streak, longest_streak = excluded.longest_streak, last_activity_date = excluded.last_activity_date, updated_at = now();
end;
$$;

create or replace function public.get_streak_snapshot(p_user_id uuid)
returns table (current_streak integer, longest_streak integer, last_activity_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  user_zone text;
  today_local date;
  stored public.streaks%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  select coalesce(nullif(timezone, ''), 'UTC') into user_zone from public.profiles where id = p_user_id;
  begin
    today_local := timezone(coalesce(user_zone, 'UTC'), now())::date;
  exception when others then
    today_local := timezone('UTC', now())::date;
  end;
  select * into stored from public.streaks where user_id = p_user_id;
  if not found then
    return query select 0, 0, null::date;
  elsif stored.last_activity_date < today_local - 1 then
    return query select 0, stored.longest_streak, stored.last_activity_date;
  else
    return query select stored.current_streak, stored.longest_streak, stored.last_activity_date;
  end if;
end;
$$;

create or replace function public.persist_meal_analysis(p_user_id uuid, p_event_key text, p_image_url text, p_meal_name text, p_captured_at timestamptz, p_provider text, p_analysis jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_meal_id uuid;
  saved_meal_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  select meal_id into existing_meal_id from public.meal_ingest_events where event_key = p_event_key limit 1;
  if existing_meal_id is not null then return existing_meal_id; end if;
  insert into public.meals (user_id, image_url, meal_name, status, captured_at)
  values (p_user_id, p_image_url, left(coalesce(p_meal_name, 'Meal'), 120), 'analysed', coalesce(p_captured_at, now()))
  returning id into saved_meal_id;
  insert into public.meal_analyses (meal_id, rating, score, indicators, explanation, recommendations, meal_guidance, daily_tasks)
  values (saved_meal_id, coalesce(p_analysis->>'rating', 'Reasonable'), greatest(0, least(100, coalesce((p_analysis->>'score')::integer, 60))), coalesce(p_analysis->'indicators', '{}'::jsonb), coalesce(p_analysis->>'explanation', ''), coalesce(p_analysis->'mealGuidance', p_analysis->'recommendations', '[]'::jsonb), coalesce(p_analysis->'mealGuidance', p_analysis->'recommendations', '[]'::jsonb), coalesce(p_analysis->'dailyTasks', '[]'::jsonb));
  insert into public.meal_ingest_events (event_key, user_id, meal_id) values (p_event_key, p_user_id, saved_meal_id);
  perform public.refresh_neulifi_score(p_user_id);
  perform public.record_activity_internal(p_user_id, 'meal_scan', saved_meal_id::text);
  perform public.record_referral_scan(p_user_id, 'scan:' || saved_meal_id::text);
  return saved_meal_id;
end;
$$;

revoke all on function public.get_streak_snapshot(uuid) from public, anon;
grant execute on function public.get_streak_snapshot(uuid) to authenticated;
revoke all on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
