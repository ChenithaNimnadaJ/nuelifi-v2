-- Route all referral reward callers through the 15% amount-aware implementation.
-- The three-argument wrapper remains for legacy callers and delegates safely.

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

  select * into referral_row
    from public.referrals
   where referred_user_id = p_referred_user_id
   limit 1;
  if referral_row.id is null then return; end if;

  if p_paid_amount is not null and p_paid_amount >= 0 then
    plan_amount := round(p_paid_amount, 6);
    amount_source := 'paddle_transaction';
  else
    select coalesce(pc.annual_price, pc.price) into plan_amount
      from public.plan_catalog pc
     where pc.id = normalized_plan and pc.active = true
     limit 1;
  end if;
  if plan_amount is null or plan_amount <= 0 then return; end if;

  select coalesce(setting_value, 15) into commission_percent
    from public.referral_settings
   where setting_key = 'paid_commission_percent';
  if commission_percent is null or commission_percent < 0 or commission_percent > 100 then
    commission_percent := 15;
  end if;

  reward_amount := round(plan_amount * commission_percent / 100, 6);
  if reward_amount <= 0 then return; end if;
  reward_key := 'paid:' || subscription_key;

  insert into public.referral_events (referral_id, event_type, event_key, amount)
  values (referral_row.id, 'paid_subscription', reward_key, reward_amount)
  on conflict (event_key) do nothing
  returning id into event_id;

  if event_id is not null then
    insert into public.referral_rewards (
      event_id, referral_id, referrer_user_id, referred_user_id,
      reward_type, amount, metadata
    ) values (
      event_id, referral_row.id, referral_row.referrer_user_id, referral_row.referred_user_id,
      'paid_subscription', reward_amount,
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
begin
  perform public.record_paid_referral_reward(
    p_referred_user_id,
    p_subscription_key,
    p_plan,
    null
  );
end;
$$;

revoke all on function public.record_paid_referral_reward(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.record_paid_referral_reward(uuid, text, text, numeric) to service_role;
revoke all on function public.record_paid_referral_reward(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_paid_referral_reward(uuid, text, text) to service_role;
