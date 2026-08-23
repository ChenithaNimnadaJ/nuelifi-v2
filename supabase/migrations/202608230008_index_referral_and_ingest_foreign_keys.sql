-- Add covering indexes for foreign keys used by activity, payment-claim, and referral queries.
create index if not exists meal_ingest_events_user_id_idx
  on public.meal_ingest_events (user_id);

create index if not exists paddle_pending_purchases_claimed_user_id_idx
  on public.paddle_pending_purchases (claimed_user_id);

create index if not exists referral_events_referral_id_idx
  on public.referral_events (referral_id);

create index if not exists referral_rewards_referral_id_idx
  on public.referral_rewards (referral_id);

create index if not exists referral_rewards_referred_user_id_idx
  on public.referral_rewards (referred_user_id);

create index if not exists referral_rewards_referrer_user_id_idx
  on public.referral_rewards (referrer_user_id);

create index if not exists referrals_referral_code_idx
  on public.referrals (referral_code);
