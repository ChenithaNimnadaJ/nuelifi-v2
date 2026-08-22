create or replace function public.mark_paddle_pending_purchase_inactive(
  p_paddle_subscription_id text,
  p_provider_status text,
  p_provider_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.paddle_pending_purchases
  set status = 'superseded',
      provider_status = nullif(btrim(p_provider_status), ''),
      provider_data = coalesce(p_provider_data, provider_data),
      event_at = coalesce(p_event_at, now()),
      updated_at = now()
  where paddle_subscription_id = nullif(btrim(p_paddle_subscription_id), '')
    and status = 'pending'
    and (p_event_at is null or event_at <= p_event_at);
end;
$$;

revoke all on function public.mark_paddle_pending_purchase_inactive(text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_paddle_pending_purchase_inactive(text, text, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
