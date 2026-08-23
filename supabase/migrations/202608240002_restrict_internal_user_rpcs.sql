-- Keep privileged cross-table operations behind the verified Worker.
-- Browser clients must use the Worker routes, which authenticate the bearer token first.

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
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  if normalized_code = '' then return false; end if;
  if exists (select 1 from public.referrals where referred_user_id = p_user_id) then return false; end if;
  select user_id into referrer_id from public.referral_codes where code = normalized_code and active = true limit 1;
  if referrer_id is null or referrer_id = p_user_id then return false; end if;
  insert into public.referrals (referrer_user_id, referred_user_id, referral_code)
  values (referrer_id, p_user_id, normalized_code)
  on conflict (referred_user_id) do nothing;
  return true;
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
  if owner_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and (auth.uid() is null or owner_id <> auth.uid())) then
    raise exception 'Task not found';
  end if;
  perform set_config('neulifi.internal_action_update', 'on', true);
  update public.actions
     set completed = p_completed,
         completed_at = case when p_completed then now() else null end
   where id = p_action_id;
  perform set_config('neulifi.internal_action_update', 'off', true);
  if p_completed then perform public.record_activity_internal(owner_id, 'task_completion', p_action_id::text); end if;
end;
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
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  select code into existing_code from public.referral_codes where user_id = p_user_id and active = true limit 1;
  if existing_code is not null then return existing_code; end if;
  loop
    next_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.referral_codes where code = next_code);
  end loop;
  insert into public.referral_codes (user_id, code) values (p_user_id, next_code);
  return next_code;
end;
$$;

create or replace function public.ensure_user_records(p_user_id uuid, p_name text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  insert into public.profiles (id, name)
  values (p_user_id, left(coalesce(p_name, ''), 120))
  on conflict (id) do update
    set name = case
      when public.profiles.name = '' and excluded.name <> '' then excluded.name
      else public.profiles.name
    end;
  insert into public.subscriptions (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
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
  paid_this_month integer;
  scans integer;
  pending numeric(12, 6);
  available numeric(12, 6);
  lifetime numeric(12, 6);
  standard_pro numeric(12, 6);
  standard_premium numeric(12, 6);
  high_volume_pro numeric(12, 6);
  high_volume_premium numeric(12, 6);
  high_volume_threshold integer;
  current_month_start timestamptz := date_trunc('month', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  select code into code_value from public.referral_codes where user_id = p_user_id and active = true limit 1;
  select count(*)::integer into referred_count from public.referrals where referrer_user_id = p_user_id;
  select count(distinct referred_user_id)::integer into paid_count
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'paid_subscription' and status <> 'reversed';
  select count(distinct referred_user_id)::integer into paid_this_month
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'paid_subscription' and status <> 'reversed'
     and created_at >= current_month_start and created_at < current_month_start + interval '1 month';
  select count(*)::integer into scans
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'meal_scan' and status <> 'reversed';
  select coalesce(sum(amount) filter (where status = 'pending'), 0),
         coalesce(sum(amount) filter (where status = 'available'), 0),
         coalesce(sum(amount) filter (where status <> 'reversed'), 0)
    into pending, available, lifetime
    from public.referral_rewards where referrer_user_id = p_user_id;
  select coalesce(setting_value, 1) into standard_pro from public.referral_settings where setting_key = 'paid_pro_reward';
  select coalesce(setting_value, 3) into standard_premium from public.referral_settings where setting_key = 'paid_premium_reward';
  select coalesce(setting_value, 2) into high_volume_pro from public.referral_settings where setting_key = 'paid_pro_high_volume_reward';
  select coalesce(setting_value, 5) into high_volume_premium from public.referral_settings where setting_key = 'paid_premium_high_volume_reward';
  select coalesce(round(setting_value)::integer, 100) into high_volume_threshold from public.referral_settings where setting_key = 'paid_high_volume_threshold';
  return jsonb_build_object(
    'code', code_value,
    'referredUsers', referred_count,
    'paidUsers', paid_count,
    'paidUsersThisMonth', paid_this_month,
    'referredScans', scans,
    'pendingEarnings', pending,
    'availableEarnings', available,
    'lifetimeEarnings', lifetime,
    'standardProCommission', standard_pro,
    'standardPremiumCommission', standard_premium,
    'highVolumeProCommission', high_volume_pro,
    'highVolumePremiumCommission', high_volume_premium,
    'highVolumeThreshold', high_volume_threshold
  );
end;
$$;

create or replace function public.mark_missed_tasks(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  update public.actions
     set status = 'missed'
   where user_id = p_user_id and completed = false and status = 'upcoming' and due_at is not null and due_at < now();
end;
$$;

create or replace function public.release_ai_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  day_start date := timezone('utc', now())::date;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  update public.ai_usage
     set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user_id and period_start = day_start;
end;
$$;

create or replace function public.reserve_ai_usage(p_user_id uuid)
returns table(allowed boolean, plan text, status text, used integer, usage_limit integer, analysis_level text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_plan text;
  current_status text;
  current_limit integer;
  current_level text;
  current_used integer;
  day_start date := timezone('utc', now())::date;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  select * into current_plan, current_status, current_used, current_limit, current_level from public.current_ai_usage(p_user_id);
  insert into public.ai_usage (user_id, period_start, analyses_used)
  values (p_user_id, day_start, 0)
  on conflict (user_id, period_start) do nothing;
  select u.analyses_used into current_used from public.ai_usage u
   where u.user_id = p_user_id and u.period_start = day_start for update;
  if current_used >= current_limit then
    return query select false, current_plan, current_status, current_used, current_limit, current_level;
    return;
  end if;
  update public.ai_usage set analyses_used = current_used + 1
   where user_id = p_user_id and period_start = day_start;
  return query select true, current_plan, current_status, current_used + 1, current_limit, current_level;
end;
$$;

create or replace function public.current_ai_usage(p_user_id uuid)
returns table(plan text, status text, used integer, usage_limit integer, analysis_level text)
language plpgsql
set search_path = public
as $$
declare
  current_plan text;
  current_status text;
  current_limit integer;
  current_level text;
  day_start date := timezone('utc', now())::date;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;
  select coalesce(s.plan, 'free'), coalesce(s.status, 'active')
    into current_plan, current_status
    from public.subscriptions s where s.user_id = p_user_id limit 1;
  if current_status <> 'active' then current_plan := 'free'; end if;
  select pc.daily_ai_usage_limit, pc.analysis_level into current_limit, current_level
    from public.plan_catalog pc where pc.id = current_plan and pc.active = true;
  if current_limit is null then
    select pc.daily_ai_usage_limit, pc.analysis_level into current_limit, current_level
      from public.plan_catalog pc where pc.id = 'free';
    current_plan := 'free';
  end if;
  return query select current_plan, current_status,
    coalesce((select u.analyses_used from public.ai_usage u where u.user_id = p_user_id and u.period_start = day_start), 0),
    current_limit, current_level;
end;
$$;

revoke all on function public.attribute_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_action(uuid, boolean) from public, anon, authenticated;
revoke all on function public.ensure_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.ensure_user_records(uuid, text) from public, anon, authenticated;
revoke all on function public.get_referral_summary(uuid) from public, anon, authenticated;
revoke all on function public.mark_missed_tasks(uuid) from public, anon, authenticated;
revoke all on function public.release_ai_usage(uuid) from public, anon, authenticated;
revoke all on function public.reserve_ai_usage(uuid) from public, anon, authenticated;

grant execute on function public.attribute_referral(uuid, text) to service_role;
grant execute on function public.complete_action(uuid, boolean) to service_role;
grant execute on function public.ensure_referral_code(uuid) to service_role;
grant execute on function public.ensure_user_records(uuid, text) to service_role;
grant execute on function public.get_referral_summary(uuid) to service_role;
grant execute on function public.mark_missed_tasks(uuid) to service_role;
grant execute on function public.release_ai_usage(uuid) to service_role;
grant execute on function public.reserve_ai_usage(uuid) to service_role;
