begin;

-- Cover the foreign-key columns identified by the Supabase performance advisor.
-- These are backend/service-role tables; this migration does not change their
-- existing grants or intentionally service-only access model.
create index if not exists affiliate_payout_country_methods_option_idx
  on public.affiliate_payout_country_methods (method_type, currency, network);

create index if not exists affiliate_payout_request_events_actor_idx
  on public.affiliate_payout_request_events (actor_id);

create index if not exists affiliate_payout_requests_paid_by_idx
  on public.affiliate_payout_requests (paid_by);

create index if not exists affiliate_payout_requests_payout_method_idx
  on public.affiliate_payout_requests (payout_method_id);

create index if not exists affiliate_payout_requests_reviewer_idx
  on public.affiliate_payout_requests (reviewer_id);

commit;
