create or replace function public.stage_paddle_pending_purchase(
  p_paddle_customer_id text,
  p_paddle_subscription_id text,
  p_paddle_transaction_id text,
  p_email text,
  p_plan text,
  p_billing_interval text,
  p_price_id text,
  p_provider_status text,
  p_provider_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_event_at timestamptz := coalesce(p_event_at, now());
begin
  if p_plan not in ('pro', 'premium') or p_billing_interval <> 'year' then
    raise exception 'Unsupported pending Paddle purchase';
  end if;
  if nullif(btrim(p_paddle_subscription_id), '') is null then
    raise exception 'Pending Paddle purchase requires a subscription ID';
  end if;

  insert into public.paddle_pending_purchases (
    paddle_customer_id, paddle_subscription_id, paddle_transaction_id,
    email, plan, billing_interval, price_id, provider_status,
    provider_data, event_at
  ) values (
    nullif(btrim(p_paddle_customer_id), ''),
    nullif(btrim(p_paddle_subscription_id), ''),
    nullif(btrim(p_paddle_transaction_id), ''),
    nullif(btrim(p_email), ''),
    p_plan,
    p_billing_interval,
    nullif(btrim(p_price_id), ''),
    nullif(btrim(p_provider_status), ''),
    coalesce(p_provider_data, '{}'::jsonb),
    normalized_event_at
  )
  on conflict (paddle_subscription_id) where paddle_subscription_id is not null do update set
    paddle_customer_id = coalesce(excluded.paddle_customer_id, paddle_pending_purchases.paddle_customer_id),
    paddle_transaction_id = coalesce(excluded.paddle_transaction_id, paddle_pending_purchases.paddle_transaction_id),
    email = coalesce(excluded.email, paddle_pending_purchases.email),
    plan = excluded.plan,
    billing_interval = excluded.billing_interval,
    price_id = coalesce(excluded.price_id, paddle_pending_purchases.price_id),
    provider_status = coalesce(excluded.provider_status, paddle_pending_purchases.provider_status),
    provider_data = excluded.provider_data,
    event_at = excluded.event_at,
    updated_at = now()
  where paddle_pending_purchases.event_at <= excluded.event_at;
end;
$$;

revoke all on function public.stage_paddle_pending_purchase(text, text, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.stage_paddle_pending_purchase(text, text, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
