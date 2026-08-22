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

  if nullif(btrim(p_email), '') is not null then
    update public.paddle_pending_purchases
    set email = p_email, updated_at = now()
    where paddle_customer_id = p_paddle_customer_id
      and status = 'pending'
      and (email is null or btrim(email) = '');
  end if;
end;
$$;

revoke all on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) to service_role;

create or replace function public.claim_paddle_pending_purchases(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  account_email text;
  claimed_count integer := 0;
  claimed_plan text := null;
  purchase record;
  next_status text;
begin
  if auth.uid() is distinct from p_user_id and current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Not allowed to claim Paddle purchases for this user';
  end if;

  select lower(btrim(email)) into account_email from auth.users where id = p_user_id;
  if account_email is null or account_email = '' then
    return jsonb_build_object('claimed', 0, 'plan', null);
  end if;

  for purchase in
    select *
    from public.paddle_pending_purchases
    where status = 'pending'
      and claimed_user_id is null
      and email_normalized = account_email
      and provider_status in ('active', 'trialing')
      and created_at >= now() - interval '30 days'
    order by event_at asc
    for update skip locked
  loop
    next_status := case when purchase.provider_status in ('active', 'trialing') then 'active' else 'past_due' end;

    insert into public.subscriptions (
      user_id, plan, status, provider, provider_customer_id,
      provider_subscription_id, billing_interval, price_id,
      provider_status, provider_data, last_provider_event_at
    ) values (
      p_user_id, purchase.plan, next_status, 'paddle', purchase.paddle_customer_id,
      purchase.paddle_subscription_id, purchase.billing_interval, purchase.price_id,
      purchase.provider_status, purchase.provider_data, purchase.event_at
    )
    on conflict (user_id) do update set
      plan = case when subscriptions.plan = 'premium' or excluded.plan = 'premium' then 'premium' else excluded.plan end,
      status = excluded.status,
      provider = 'paddle',
      provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
      provider_subscription_id = coalesce(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
      billing_interval = excluded.billing_interval,
      price_id = coalesce(excluded.price_id, subscriptions.price_id),
      provider_status = excluded.provider_status,
      provider_data = excluded.provider_data,
      last_provider_event_at = excluded.last_provider_event_at;

    if purchase.paddle_customer_id is not null then
      insert into public.paddle_customers (user_id, paddle_customer_id, email, custom_data)
      values (p_user_id, purchase.paddle_customer_id, purchase.email, coalesce(purchase.provider_data->'custom_data', '{}'::jsonb))
      on conflict (paddle_customer_id) do update set
        user_id = case when paddle_customers.user_id is null or paddle_customers.user_id = p_user_id then p_user_id else paddle_customers.user_id end,
        email = coalesce(paddle_customers.email, excluded.email),
        custom_data = case when excluded.custom_data = '{}'::jsonb then paddle_customers.custom_data else excluded.custom_data end,
        updated_at = now();
    end if;

    update public.paddle_pending_purchases
    set status = 'claimed', claimed_user_id = p_user_id, claimed_at = now(), updated_at = now()
    where id = purchase.id;

    claimed_count := claimed_count + 1;
    if claimed_plan is null or (claimed_plan = 'pro' and purchase.plan = 'premium') then
      claimed_plan := purchase.plan;
    end if;
  end loop;

  return jsonb_build_object('claimed', claimed_count, 'plan', claimed_plan);
end;
$$;

revoke all on function public.claim_paddle_pending_purchases(uuid) from public, anon;
grant execute on function public.claim_paddle_pending_purchases(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
