create or replace function public.sync_paddle_customer(
  p_user_id uuid,
  p_paddle_customer_id text,
  p_email text,
  p_name text,
  p_locale text,
  p_status text,
  p_marketing_consent boolean,
  p_custom_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.paddle_customers (
    user_id, paddle_customer_id, email, name, locale, status,
    marketing_consent, custom_data, first_seen_at, last_event_at
  )
  values (
    p_user_id, p_paddle_customer_id, p_email, p_name, p_locale, p_status,
    p_marketing_consent, coalesce(p_custom_data, '{}'::jsonb), coalesce(p_event_at, now()), coalesce(p_event_at, now())
  )
  on conflict (paddle_customer_id) do update set
    user_id = coalesce(excluded.user_id, paddle_customers.user_id),
    email = coalesce(excluded.email, paddle_customers.email),
    name = coalesce(excluded.name, paddle_customers.name),
    locale = coalesce(excluded.locale, paddle_customers.locale),
    status = coalesce(excluded.status, paddle_customers.status),
    marketing_consent = coalesce(excluded.marketing_consent, paddle_customers.marketing_consent),
    custom_data = case when excluded.custom_data = '{}'::jsonb then paddle_customers.custom_data else excluded.custom_data end,
    last_event_at = excluded.last_event_at
  where paddle_customers.last_event_at is null or paddle_customers.last_event_at <= excluded.last_event_at;
end;
$$;

revoke all on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) to service_role;

create or replace function public.sync_paddle_subscription(
  p_user_id uuid,
  p_plan text,
  p_status text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_billing_interval text,
  p_price_id text,
  p_provider_status text,
  p_current_billing_period jsonb,
  p_scheduled_change jsonb,
  p_provider_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (
    user_id, plan, status, provider, provider_customer_id, provider_subscription_id,
    billing_interval, price_id, provider_status, current_billing_period,
    scheduled_change, provider_data, last_provider_event_at
  )
  values (
    p_user_id, p_plan, p_status, 'paddle', p_provider_customer_id, p_provider_subscription_id,
    p_billing_interval, p_price_id, p_provider_status, p_current_billing_period,
    p_scheduled_change, coalesce(p_provider_data, '{}'::jsonb), coalesce(p_event_at, now())
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    provider = excluded.provider,
    provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
    billing_interval = coalesce(excluded.billing_interval, subscriptions.billing_interval),
    price_id = coalesce(excluded.price_id, subscriptions.price_id),
    provider_status = excluded.provider_status,
    current_billing_period = excluded.current_billing_period,
    scheduled_change = excluded.scheduled_change,
    provider_data = excluded.provider_data,
    last_provider_event_at = excluded.last_provider_event_at
  where subscriptions.last_provider_event_at is null or subscriptions.last_provider_event_at <= excluded.last_provider_event_at;
end;
$$;

revoke all on function public.sync_paddle_subscription(uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_paddle_subscription(uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
