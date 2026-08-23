-- Align verified paid-referral commissions with the published affiliate rules.
-- This migration is additive and does not rewrite historical rewards.

insert into public.referral_settings (setting_key, setting_value)
values
  ('paid_pro_reward', 1),
  ('paid_premium_reward', 3),
  ('paid_pro_high_volume_reward', 2),
  ('paid_premium_high_volume_reward', 5),
  ('paid_high_volume_threshold', 100)
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    updated_at = now();

create or replace function public.record_paid_referral_reward(
  p_referred_user_id uuid,
  p_subscription_key text,
  p_plan text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referral_row public.referrals%rowtype;
  event_id uuid;
  normalized_plan text := lower(trim(coalesce(p_plan, '')));
  subscription_key text := trim(coalesce(p_subscription_key, ''));
  current_month_start timestamptz := date_trunc('month', now());
  current_month_users integer := 0;
  qualified_users integer := 0;
  high_volume_threshold integer := 100;
  is_new_qualified_user boolean := false;
  standard_rate numeric(12, 6) := 0;
  high_volume_rate numeric(12, 6) := 0;
  reward_amount numeric(12, 6) := 0;
  commission_tier text := 'standard';
  reward_key text;
begin
  if normalized_plan not in ('pro', 'premium') or subscription_key = '' then
    return;
  end if;

  select *
    into referral_row
    from public.referrals
   where referred_user_id = p_referred_user_id
   limit 1;

  if referral_row.id is null then
    return;
  end if;

  reward_key := 'paid:' || subscription_key;

  select count(distinct rr.referred_user_id)::integer
    into current_month_users
    from public.referral_rewards rr
    join public.referrals r on r.id = rr.referral_id
   where r.referrer_user_id = referral_row.referrer_user_id
     and rr.reward_type = 'paid_subscription'
     and rr.status <> 'reversed'
     and rr.created_at >= current_month_start
     and rr.created_at < current_month_start + interval '1 month';

  select not exists (
    select 1
      from public.referral_rewards rr
     where rr.referrer_user_id = referral_row.referrer_user_id
       and rr.referred_user_id = p_referred_user_id
       and rr.reward_type = 'paid_subscription'
       and rr.status <> 'reversed'
       and rr.created_at >= current_month_start
       and rr.created_at < current_month_start + interval '1 month'
  ) into is_new_qualified_user;

  qualified_users := current_month_users + case when is_new_qualified_user then 1 else 0 end;

  select coalesce(setting_value, case when normalized_plan = 'premium' then 3 else 1 end)
    into standard_rate
    from public.referral_settings
   where setting_key = case when normalized_plan = 'premium' then 'paid_premium_reward' else 'paid_pro_reward' end;

  select coalesce(setting_value, case when normalized_plan = 'premium' then 5 else 2 end)
    into high_volume_rate
    from public.referral_settings
   where setting_key = case when normalized_plan = 'premium' then 'paid_premium_high_volume_reward' else 'paid_pro_high_volume_reward' end;

  select coalesce(round(setting_value)::integer, 100)
    into high_volume_threshold
    from public.referral_settings
   where setting_key = 'paid_high_volume_threshold';

  if qualified_users > high_volume_threshold then
    commission_tier := 'high_volume';
    reward_amount := high_volume_rate;
  else
    reward_amount := standard_rate;
  end if;

  insert into public.referral_events (referral_id, event_type, event_key, amount)
  values (referral_row.id, 'paid_subscription', reward_key, reward_amount)
  on conflict (event_key) do nothing
  returning id into event_id;

  if event_id is not null then
    insert into public.referral_rewards (
      event_id,
      referral_id,
      referrer_user_id,
      referred_user_id,
      reward_type,
      amount,
      metadata
    )
    values (
      event_id,
      referral_row.id,
      referral_row.referrer_user_id,
      referral_row.referred_user_id,
      'paid_subscription',
      reward_amount,
      jsonb_build_object(
        'subscription_key', subscription_key,
        'plan', normalized_plan,
        'commission_tier', commission_tier,
        'qualified_paid_users_this_month', qualified_users,
        'verified_event', true
      )
    );
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
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;

  select code
    into code_value
    from public.referral_codes
   where user_id = p_user_id
     and active = true
   limit 1;

  select count(*)::integer
    into referred_count
    from public.referrals
   where referrer_user_id = p_user_id;

  select count(distinct referred_user_id)::integer
    into paid_count
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'paid_subscription'
     and status <> 'reversed';

  select count(distinct referred_user_id)::integer
    into paid_this_month
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'paid_subscription'
     and status <> 'reversed'
     and created_at >= current_month_start
     and created_at < current_month_start + interval '1 month';

  select count(*)::integer
    into scans
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'meal_scan'
     and status <> 'reversed';

  select
    coalesce(sum(amount) filter (where status = 'pending'), 0),
    coalesce(sum(amount) filter (where status = 'available'), 0),
    coalesce(sum(amount) filter (where status <> 'reversed'), 0)
    into pending, available, lifetime
    from public.referral_rewards
   where referrer_user_id = p_user_id;

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

revoke all on function public.record_paid_referral_reward(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_paid_referral_reward(uuid, text, text) to service_role;

revoke all on function public.get_referral_summary(uuid) from public, anon;
grant execute on function public.get_referral_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
