create or replace function public.claim_payment_event(p_event_id text, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_events (event_id, event_type, status)
  values (p_event_id, p_event_type, 'pending')
  on conflict (event_id) do nothing;
  return found;
end;
$$;

revoke all on function public.claim_payment_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_payment_event(text, text) to service_role;

notify pgrst, 'reload schema';
