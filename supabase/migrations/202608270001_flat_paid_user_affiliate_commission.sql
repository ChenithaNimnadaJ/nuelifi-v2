begin;

-- Affiliate policy: only verified paid users earn commission. The percentage is
-- stored centrally, while the plan amount comes from the canonical plan catalog.
delete from public.referral_settings
 where setting_key in (
   'meal_scan_reward',
   'paid_pro_reward',
   'paid_premium_reward',
   'paid_pro_high_volume_reward',
   'paid_premium_high_volume_reward',
   'paid_high_volume_threshold'
 );

insert into public.referral_settings (setting_key, setting_value)
values ('paid_commission_percent', 30)
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    updated_at = now();

-- Meal scans remain an observable referral metric, but no longer create money.
-- This keeps old callers safe while making the new policy fail closed.
create or replace function public.record_referral_scan(
  p_referred_user_id uuid,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  return;
end;
$$;

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
  plan_amount numeric(12, 6);
  commission_percent numeric(12, 6);
  reward_amount numeric(12, 6);
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

  select coalesce(pc.annual_price, pc.price)
    into plan_amount
    from public.plan_catalog pc
   where pc.id = normalized_plan
     and pc.active = true
   limit 1;

  if plan_amount is null or plan_amount <= 0 then
    return;
  end if;

  select coalesce(setting_value, 30)
    into commission_percent
    from public.referral_settings
   where setting_key = 'paid_commission_percent';

  if commission_percent is null or commission_percent < 0 or commission_percent > 100 then
    commission_percent := 30;
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

  select coalesce(setting_value, 30)
    into commission_percent
    from public.referral_settings
   where setting_key = 'paid_commission_percent';

  if commission_percent is null or commission_percent < 0 or commission_percent > 100 then
    commission_percent := 30;
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

-- Payouts may only draw from the new paid-user commission ledger. Existing
-- reservation, wallet, minimum, and manual-review safeguards are preserved.
create or replace function public.create_affiliate_payout_request(
  p_affiliate_id uuid,
  p_requested_amount numeric,
  p_request_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  method_row public.affiliate_payout_methods%rowtype;
  request_row public.affiliate_payout_requests%rowtype;
  available_rewards numeric(12, 6);
  reserved_payouts numeric(12, 6);
  eligible_balance numeric(12, 6);
  affiliate_email text;
  affiliate_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;

  select u.email, coalesce(nullif(p.name, ''), nullif(u.raw_user_meta_data ->> 'name', ''), '')
    into affiliate_email, affiliate_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_affiliate_id;

  if affiliate_email is null and affiliate_name is null then
    raise exception 'Affiliate account was not found';
  end if;

  perform 1 from auth.users where id = p_affiliate_id for update;

  select * into method_row
    from public.affiliate_payout_methods
   where affiliate_id = p_affiliate_id
     and is_active
     and method_type = 'crypto_transfer'
   order by updated_at desc
   limit 1
   for update;

  if method_row.id is null then
    raise exception 'Add a crypto payout method before requesting a payout';
  end if;

  if exists (
    select 1 from public.affiliate_payout_requests
     where affiliate_id = p_affiliate_id and status = 'pending'
  ) then
    raise exception 'A payout request is already pending';
  end if;

  select coalesce(sum(amount), 0)
    into available_rewards
    from public.referral_rewards
   where referrer_user_id = p_affiliate_id
     and reward_type = 'paid_subscription'
     and status = 'available';

  select coalesce(sum(requested_amount), 0)
    into reserved_payouts
    from public.affiliate_payout_requests
   where affiliate_id = p_affiliate_id
     and status in ('pending', 'approved', 'paid');

  eligible_balance := greatest(0, available_rewards - reserved_payouts);

  if p_requested_amount is null or p_requested_amount < 5 then
    raise exception 'The minimum payout is $5.00';
  end if;
  if p_requested_amount > eligible_balance then
    raise exception 'The requested amount exceeds your available balance';
  end if;

  insert into public.affiliate_payout_requests (
    affiliate_id, affiliate_name, affiliate_email, payout_method_id, country_code,
    requested_amount, currency, available_balance_snapshot,
    method_type, method_currency, network,
    wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext,
    destination_preview, destination_last4, request_note
  ) values (
    p_affiliate_id, left(coalesce(affiliate_name, ''), 120), left(affiliate_email, 320), method_row.id, method_row.country_code,
    round(p_requested_amount, 6), 'USD', eligible_balance,
    'crypto_transfer', method_row.currency, method_row.network,
    method_row.wallet_address_ciphertext, method_row.wallet_address_last4, method_row.memo_tag_ciphertext,
    method_row.destination_preview, method_row.destination_last4, left(coalesce(p_request_note, ''), 500)
  ) returning * into request_row;

  insert into public.affiliate_payout_request_events (payout_request_id, actor_id, event_type, to_status, note)
  values (request_row.id, p_affiliate_id, 'created', request_row.status, request_row.request_note);

  return jsonb_build_object(
    'id', request_row.id,
    'affiliateId', request_row.affiliate_id,
    'requestedAmount', request_row.requested_amount,
    'currency', request_row.currency,
    'availableBalanceSnapshot', request_row.available_balance_snapshot,
    'status', request_row.status,
    'countryCode', request_row.country_code,
    'methodType', 'crypto_transfer',
    'methodCurrency', request_row.method_currency,
    'network', request_row.network,
    'destinationPreview', request_row.destination_preview,
    'destinationLast4', request_row.destination_last4,
    'hasMemoTag', request_row.memo_tag_ciphertext is not null,
    'userMessage', null,
    'createdAt', request_row.created_at,
    'reviewedAt', null,
    'paidAt', null,
    'paymentReference', null
  );
exception
  when unique_violation then
    raise exception 'A payout request is already pending';
end;
$$;

revoke all on function public.record_referral_scan(uuid, text) from public, anon, authenticated;
revoke all on function public.record_paid_referral_reward(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_referral_summary(uuid) from public, anon, authenticated;
revoke all on function public.create_affiliate_payout_request(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.record_referral_scan(uuid, text) to service_role;
grant execute on function public.record_paid_referral_reward(uuid, text, text) to service_role;
grant execute on function public.get_referral_summary(uuid) to service_role;
grant execute on function public.create_affiliate_payout_request(uuid, numeric, text) to service_role;

notify pgrst, 'reload schema';
commit;
