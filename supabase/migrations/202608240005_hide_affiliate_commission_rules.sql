begin;

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
    into pending, available_rewards, lifetime
    from public.referral_rewards where referrer_user_id = p_user_id;
  select coalesce(sum(requested_amount) filter (where status in ('pending', 'approved', 'paid')), 0)
    into reserved_payouts
    from public.affiliate_payout_requests where affiliate_id = p_user_id;
  available := greatest(0, available_rewards - reserved_payouts);

  return jsonb_build_object(
    'code', code_value,
    'referredUsers', referred_count,
    'paidUsers', paid_count,
    'paidUsersThisMonth', paid_this_month,
    'referredScans', scans,
    'pendingEarnings', pending,
    'availableEarnings', available,
    'lifetimeEarnings', lifetime
  );
end;
$$;

revoke all on function public.get_referral_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_referral_summary(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
