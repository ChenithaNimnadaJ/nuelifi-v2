alter table public.profiles
  add column if not exists region text not null default 'global',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists leaderboard_opt_in boolean not null default false,
  add column if not exists neulifi_score integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_neulifi_score_check;
alter table public.profiles
  add constraint profiles_neulifi_score_check check (neulifi_score between 0 and 100);

alter table public.actions
  add column if not exists description text not null default '',
  add column if not exists due_at timestamptz,
  add column if not exists status text not null default 'upcoming';

alter table public.actions
  drop constraint if exists actions_status_check;
alter table public.actions
  add constraint actions_status_check check (status in ('upcoming', 'completed', 'missed'));

update public.actions
set status = case
  when completed then 'completed'
  when due_at is not null and due_at < now() then 'missed'
  else 'upcoming'
end;

create index if not exists profiles_leaderboard_idx on public.profiles (leaderboard_opt_in, neulifi_score desc, updated_at);
create index if not exists actions_due_status_idx on public.actions (user_id, status, due_at);

create table if not exists public.streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_activity_date date,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists user_activity_days_date_idx on public.user_activity_days (activity_date desc, user_id);

create table if not exists public.meal_ingest_events (
  event_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid not null unique references public.meals(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null references public.referral_codes(code),
  created_at timestamptz not null default now(),
  locked_at timestamptz not null default now(),
  constraint referrals_no_self check (referrer_user_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id, created_at desc);

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  event_type text not null check (event_type in ('meal_scan', 'paid_subscription')),
  event_key text not null unique,
  amount numeric(12, 6) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.referral_rewards (
  event_id uuid primary key references public.referral_events(id) on delete restrict,
  referral_id uuid not null references public.referrals(id) on delete restrict,
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  reward_type text not null check (reward_type in ('meal_scan', 'paid_subscription')),
  amount numeric(12, 6) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending', 'available', 'reversed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_settings (
  setting_key text primary key,
  setting_value numeric(12, 6) not null check (setting_value >= 0),
  updated_at timestamptz not null default now()
);

insert into public.referral_settings (setting_key, setting_value)
values ('meal_scan_reward', 0.001), ('paid_pro_reward', 2), ('paid_premium_reward', 10)
on conflict (setting_key) do nothing;

alter table public.streaks enable row level security;
alter table public.user_activity_days enable row level security;
alter table public.meal_ingest_events enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_events enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.referral_settings enable row level security;

drop policy if exists streaks_owner on public.streaks;
create policy streaks_owner on public.streaks for select using ((select auth.uid()) = user_id);
drop policy if exists activity_days_owner on public.user_activity_days;
create policy activity_days_owner on public.user_activity_days for select using ((select auth.uid()) = user_id);
drop policy if exists referral_codes_owner on public.referral_codes;
create policy referral_codes_owner on public.referral_codes for select using ((select auth.uid()) = user_id);
drop policy if exists referrals_participant_read on public.referrals;
create policy referrals_participant_read on public.referrals for select using ((select auth.uid()) = referrer_user_id or (select auth.uid()) = referred_user_id);

drop policy if exists referral_events_participant_read on public.referral_events;
create policy referral_events_participant_read on public.referral_events for select using (exists (select 1 from public.referrals r where r.id = referral_events.referral_id and (select auth.uid()) in (r.referrer_user_id, r.referred_user_id)));
drop policy if exists referral_rewards_owner_read on public.referral_rewards;
create policy referral_rewards_owner_read on public.referral_rewards for select using ((select auth.uid()) = referrer_user_id);

drop policy if exists referral_settings_public_read on public.referral_settings;
create policy referral_settings_public_read on public.referral_settings for select using (false);

revoke insert, update, delete on public.streaks from anon, authenticated;
revoke insert, update, delete on public.user_activity_days from anon, authenticated;
revoke insert, update, delete on public.meal_ingest_events from anon, authenticated;
revoke insert, update, delete on public.referral_codes from anon, authenticated;
revoke insert, update, delete on public.referrals from anon, authenticated;
revoke insert, update, delete on public.referral_events from anon, authenticated;
revoke insert, update, delete on public.referral_rewards from anon, authenticated;
revoke insert, update, delete on public.referral_settings from anon, authenticated;

create or replace function public.sync_action_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.completed then
    new.status := 'completed';
  elsif new.due_at is not null and new.due_at < now() then
    new.status := 'missed';
  else
    new.status := 'upcoming';
  end if;
  return new;
end;
$$;

drop trigger if exists actions_sync_status on public.actions;
create trigger actions_sync_status before insert or update on public.actions for each row execute function public.sync_action_status();

create or replace function public.protect_profile_score()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.neulifi_score := 0;
  elsif new.neulifi_score is distinct from old.neulifi_score and current_setting('neulifi.internal_score_update', true) <> 'on' then
    new.neulifi_score := old.neulifi_score;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_score on public.profiles;
create trigger profiles_protect_score before insert or update on public.profiles for each row execute function public.protect_profile_score();

create or replace function public.refresh_neulifi_score(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_score integer;
begin
  select coalesce(round(avg(ma.score))::integer, 0)
    into next_score
    from public.meal_analyses ma
    join public.meals m on m.id = ma.meal_id
   where m.user_id = p_user_id;
  perform set_config('neulifi.internal_score_update', 'on', true);
  update public.profiles set neulifi_score = greatest(0, least(100, next_score)) where id = p_user_id;
  perform set_config('neulifi.internal_score_update', 'off', true);
  return next_score;
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
  activity_date_local := (timezone(coalesce(user_zone, 'UTC'), now()))::date;
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

create or replace function public.record_qualifying_activity(p_user_id uuid, p_activity_type text, p_activity_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  if p_activity_type not in ('meal_scan', 'task_completion') then raise exception 'Invalid activity type'; end if;
  perform public.record_activity_internal(p_user_id, p_activity_type, p_activity_key);
end;
$$;

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
  update public.actions set completed = p_completed, completed_at = case when p_completed then now() else null end where id = p_action_id;
  if p_completed then perform public.record_activity_internal(owner_id, 'task_completion', p_action_id::text); end if;
end;
$$;

create or replace function public.mark_missed_tasks(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  update public.actions set status = 'missed' where user_id = p_user_id and completed = false and status = 'upcoming' and due_at is not null and due_at < now();
end;
$$;

create or replace function public.get_leaderboard(p_user_id uuid)
returns table (rank bigint, user_id uuid, display_name text, score integer, is_current boolean)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select row_number() over (order by p.neulifi_score desc, p.updated_at asc, p.id) as rank,
           p.id as user_id,
           coalesce(nullif(left(p.name, 60), ''), 'Neulifi member') as display_name,
           p.neulifi_score as score
      from public.profiles p
     where p.leaderboard_opt_in = true
  )
  select r.rank, r.user_id, r.display_name, r.score, r.user_id = p_user_id
    from ranked r
   where r.rank <= 10 or r.user_id = p_user_id
   order by r.rank;
$$;

create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_code text;
  next_code text;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  select code into existing_code from public.referral_codes where user_id = p_user_id and active = true;
  if existing_code is not null then return existing_code; end if;
  loop
    next_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.referral_codes where code = next_code);
  end loop;
  insert into public.referral_codes (user_id, code) values (p_user_id, next_code);
  return next_code;
end;
$$;

create or replace function public.attribute_referral(p_user_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  referrer_id uuid;
  normalized_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null or auth.uid() <> p_user_id or normalized_code = '' then return false; end if;
  if exists (select 1 from public.referrals where referred_user_id = p_user_id) then return false; end if;
  select user_id into referrer_id from public.referral_codes where code = normalized_code and active = true limit 1;
  if referrer_id is null or referrer_id = p_user_id then return false; end if;
  insert into public.referrals (referrer_user_id, referred_user_id, referral_code) values (referrer_id, p_user_id, normalized_code) on conflict (referred_user_id) do nothing;
  return true;
end;
$$;

create or replace function public.record_referral_scan(p_referred_user_id uuid, p_event_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referral_row public.referrals%rowtype;
  event_id uuid;
  reward_amount numeric(12, 6);
begin
  select * into referral_row from public.referrals where referred_user_id = p_referred_user_id limit 1;
  if referral_row.id is null then return; end if;
  select setting_value into reward_amount from public.referral_settings where setting_key = 'meal_scan_reward';
  insert into public.referral_events (referral_id, event_type, event_key, amount)
  values (referral_row.id, 'meal_scan', p_event_key, coalesce(reward_amount, 0.001))
  on conflict (event_key) do nothing
  returning id into event_id;
  if event_id is not null then
    insert into public.referral_rewards (event_id, referral_id, referrer_user_id, referred_user_id, reward_type, amount, metadata)
    values (event_id, referral_row.id, referral_row.referrer_user_id, referral_row.referred_user_id, 'meal_scan', coalesce(reward_amount, 0.001), jsonb_build_object('event_key', p_event_key));
  end if;
end;
$$;

create or replace function public.record_paid_referral_reward(p_referred_user_id uuid, p_subscription_key text, p_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referral_row public.referrals%rowtype;
  event_id uuid;
  reward_amount numeric(12, 6);
  reward_key text := 'paid:' || p_subscription_key;
begin
  if p_plan not in ('pro', 'premium') then return; end if;
  select * into referral_row from public.referrals where referred_user_id = p_referred_user_id limit 1;
  if referral_row.id is null then return; end if;
  select setting_value into reward_amount from public.referral_settings where setting_key = case when p_plan = 'premium' then 'paid_premium_reward' else 'paid_pro_reward' end;
  insert into public.referral_events (referral_id, event_type, event_key, amount)
  values (referral_row.id, 'paid_subscription', reward_key, coalesce(reward_amount, case when p_plan = 'premium' then 10 else 2 end))
  on conflict (event_key) do nothing
  returning id into event_id;
  if event_id is not null then
    insert into public.referral_rewards (event_id, referral_id, referrer_user_id, referred_user_id, reward_type, amount, metadata)
    values (event_id, referral_row.id, referral_row.referrer_user_id, referral_row.referred_user_id, 'paid_subscription', coalesce(reward_amount, case when p_plan = 'premium' then 10 else 2 end), jsonb_build_object('subscription_key', p_subscription_key, 'plan', p_plan));
  end if;
end;
$$;

create or replace function public.get_referral_summary(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_value text;
  referred_count integer;
  paid_count integer;
  scans integer;
  pending numeric(12, 6);
  available numeric(12, 6);
  lifetime numeric(12, 6);
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  select code into code_value from public.referral_codes where user_id = p_user_id and active = true limit 1;
  select count(*)::integer into referred_count from public.referrals where referrer_user_id = p_user_id;
  select count(distinct referred_user_id)::integer into paid_count from public.referral_rewards where referrer_user_id = p_user_id and reward_type = 'paid_subscription' and status <> 'reversed';
  select count(*)::integer into scans from public.referral_rewards where referrer_user_id = p_user_id and reward_type = 'meal_scan' and status <> 'reversed';
  select coalesce(sum(amount) filter (where status = 'pending'), 0), coalesce(sum(amount) filter (where status = 'available'), 0), coalesce(sum(amount) filter (where status <> 'reversed'), 0)
    into pending, available, lifetime from public.referral_rewards where referrer_user_id = p_user_id;
  return jsonb_build_object('code', code_value, 'referredUsers', referred_count, 'paidUsers', paid_count, 'referredScans', scans, 'pendingEarnings', pending, 'availableEarnings', available, 'lifetimeEarnings', lifetime);
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
  select meal_id into existing_meal_id from public.meal_ingest_events where event_key = p_event_key limit 1;
  if existing_meal_id is not null then return existing_meal_id; end if;
  insert into public.meals (user_id, image_url, meal_name, status, captured_at)
  values (p_user_id, p_image_url, left(coalesce(p_meal_name, 'Meal'), 120), 'analysed', coalesce(p_captured_at, now()))
  returning id into saved_meal_id;
  insert into public.meal_analyses (meal_id, rating, score, indicators, explanation, recommendations, meal_guidance, daily_tasks)
  values (saved_meal_id, coalesce(p_analysis->>'rating', 'Reasonable'), greatest(0, least(100, coalesce((p_analysis->>'score')::integer, 60))), coalesce(p_analysis->'indicators', '{}'::jsonb), coalesce(p_analysis->>'explanation', ''), coalesce(p_analysis->'mealGuidance', '[]'::jsonb), coalesce(p_analysis->'mealGuidance', '[]'::jsonb), coalesce(p_analysis->'dailyTasks', '[]'::jsonb));
  insert into public.meal_ingest_events (event_key, user_id, meal_id) values (p_event_key, p_user_id, saved_meal_id);
  perform public.refresh_neulifi_score(p_user_id);
  perform public.record_activity_internal(p_user_id, 'meal_scan', saved_meal_id::text);
  perform public.record_referral_scan(p_user_id, 'scan:' || saved_meal_id::text);
  return saved_meal_id;
end;
$$;

revoke all on function public.refresh_neulifi_score(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_activity_internal(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_referral_scan(uuid, text) from public, anon, authenticated;
revoke all on function public.record_paid_referral_reward(uuid, text, text) from public, anon, authenticated;
revoke all on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_leaderboard(uuid) from public, anon;
revoke all on function public.ensure_referral_code(uuid) from public, anon;
revoke all on function public.attribute_referral(uuid, text) from public, anon;
revoke all on function public.get_referral_summary(uuid) from public, anon;
revoke all on function public.complete_action(uuid, boolean) from public, anon;
revoke all on function public.mark_missed_tasks(uuid) from public, anon;
grant execute on function public.get_leaderboard(uuid) to authenticated;
grant execute on function public.ensure_referral_code(uuid) to authenticated;
grant execute on function public.attribute_referral(uuid, text) to authenticated;
grant execute on function public.get_referral_summary(uuid) to authenticated;
grant execute on function public.complete_action(uuid, boolean) to authenticated;
grant execute on function public.mark_missed_tasks(uuid) to authenticated;
grant execute on function public.record_referral_scan(uuid, text) to service_role;
grant execute on function public.record_paid_referral_reward(uuid, text, text) to service_role;
grant execute on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) to service_role;

update public.profiles p
set neulifi_score = coalesce((select round(avg(ma.score))::integer from public.meal_analyses ma join public.meals m on m.id = ma.meal_id where m.user_id = p.id), 0);

notify pgrst, 'reload schema';
