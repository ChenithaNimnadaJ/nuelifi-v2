-- Paid affiliate commission policy update.
-- Every verified paid Pro or Premium conversion earns 15% of the canonical
-- annual plan amount. Historical rewards are not rewritten.

insert into public.referral_settings (setting_key, setting_value)
values ('paid_commission_percent', 15)
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    updated_at = now();

create or replace function public.record_paid_referral_reward(
  p_referred_user_id uuid,
  p_subscription_key text,
  p_plan text,
  p_paid_amount numeric default null
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
  plan_amount numeric(12, 6);
  commission_percent numeric(12, 6);
  reward_amount numeric(12, 6);
  reward_key text;
  amount_source text := 'plan_catalog';
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

  if p_paid_amount is not null and p_paid_amount >= 0 then
    plan_amount := round(p_paid_amount, 6);
    amount_source := 'paddle_transaction';
  else
    select coalesce(pc.annual_price, pc.price)
      into plan_amount
      from public.plan_catalog pc
     where pc.id = normalized_plan
       and pc.active = true
     limit 1;
  end if;

  if plan_amount is null or plan_amount <= 0 then
    return;
  end if;

  select coalesce(setting_value, 15)
    into commission_percent
    from public.referral_settings
   where setting_key = 'paid_commission_percent';

  if commission_percent is null or commission_percent < 0 or commission_percent > 100 then
    commission_percent := 15;
  end if;

  reward_amount := round(plan_amount * commission_percent / 100, 6);
  if reward_amount <= 0 then
    return;
  end if;

  reward_key := 'paid:' || subscription_key;

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
        'plan_amount', plan_amount,
        'amount_source', amount_source,
        'commission_percent', commission_percent,
        'commission_type', 'flat_paid_user',
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
  available_rewards numeric(12, 6);
  reserved_payouts numeric(12, 6);
  available numeric(12, 6);
  lifetime numeric(12, 6);
  commission_percent numeric(12, 6);
  current_month_start timestamptz := date_trunc('month', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;

  select code into code_value
    from public.referral_codes
   where user_id = p_user_id and active = true
   limit 1;

  select count(*)::integer into referred_count
    from public.referrals where referrer_user_id = p_user_id;

  select count(distinct referred_user_id)::integer into paid_count
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'paid_subscription'
     and status <> 'reversed';

  select count(distinct referred_user_id)::integer into paid_this_month
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'paid_subscription'
     and status <> 'reversed'
     and created_at >= current_month_start
     and created_at < current_month_start + interval '1 month';

  select count(*)::integer into scans
    from public.referral_rewards
   where referrer_user_id = p_user_id
     and reward_type = 'meal_scan'
     and status <> 'reversed';

  select
    coalesce(sum(amount) filter (where reward_type = 'paid_subscription' and status = 'pending'), 0),
    coalesce(sum(amount) filter (where reward_type = 'paid_subscription' and status = 'available'), 0),
    coalesce(sum(amount) filter (where reward_type = 'paid_subscription' and status <> 'reversed'), 0)
    into pending, available_rewards, lifetime
    from public.referral_rewards
   where referrer_user_id = p_user_id;

  select coalesce(sum(requested_amount) filter (where status in ('pending', 'approved', 'paid')), 0)
    into reserved_payouts
    from public.affiliate_payout_requests
   where affiliate_id = p_user_id;

  available := greatest(0, available_rewards - reserved_payouts);

  select coalesce(setting_value, 15)
    into commission_percent
    from public.referral_settings
   where setting_key = 'paid_commission_percent';

  if commission_percent is null or commission_percent < 0 or commission_percent > 100 then
    commission_percent := 15;
  end if;

  return jsonb_build_object(
    'code', code_value,
    'referredUsers', referred_count,
    'paidUsers', paid_count,
    'paidUsersThisMonth', paid_this_month,
    'referredScans', scans,
    'pendingEarnings', pending,
    'availableEarnings', available,
    'lifetimeEarnings', lifetime,
    'paidCommissionPercent', commission_percent
  );
end;
$$;

revoke all on function public.record_paid_referral_reward(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.record_paid_referral_reward(uuid, text, text, numeric) to service_role;

revoke all on function public.get_referral_summary(uuid) from public, anon;
grant execute on function public.get_referral_summary(uuid) to authenticated, service_role;
