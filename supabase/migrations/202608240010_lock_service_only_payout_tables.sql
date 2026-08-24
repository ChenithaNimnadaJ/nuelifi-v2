begin;

-- These tables are used only by SECURITY DEFINER payout functions and the
-- service-role admin path. Keep client roles unable to read or write them even
-- if a future grant is accidentally introduced, while preserving service-role
-- access and the existing crypto-only payout workflow.
create policy affiliate_payout_country_methods_service_only
  on public.affiliate_payout_country_methods
  for all
  to public
  using (false)
  with check (false);

create policy affiliate_payout_request_events_service_only
  on public.affiliate_payout_request_events
  for all
  to public
  using (false)
  with check (false);

commit;
