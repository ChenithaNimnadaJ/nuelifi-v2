create table if not exists public.paddle_pending_purchases (
  id uuid primary key default gen_random_uuid(),
  paddle_customer_id text,
  paddle_subscription_id text,
  paddle_transaction_id text,
  email text,
  email_normalized text generated always as (lower(btrim(email))) stored,
  plan text not null check (plan in ('pro', 'premium')),
  billing_interval text not null check (billing_interval = 'year'),
  price_id text,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'superseded')),
  provider_status text,
  provider_data jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now(),
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists paddle_pending_subscription_key
  on public.paddle_pending_purchases(paddle_subscription_id)
  where paddle_subscription_id is not null;
create unique index if not exists paddle_pending_transaction_key
  on public.paddle_pending_purchases(paddle_transaction_id)
  where paddle_transaction_id is not null;
create index if not exists paddle_pending_email_idx
  on public.paddle_pending_purchases(email_normalized, status, created_at desc)
  where status = 'pending';
create index if not exists paddle_pending_customer_idx
  on public.paddle_pending_purchases(paddle_customer_id, event_at desc);

alter table public.paddle_pending_purchases enable row level security;
revoke all on public.paddle_pending_purchases from anon, authenticated;

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
  on conflict (paddle_pending_subscription_key) do update set
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
      and created_at >= now() - interval '30 days'
    order by event_at asc
    for update skip locked
  loop
    insert into public.subscriptions (
      user_id, plan, status, provider, provider_customer_id,
      provider_subscription_id, billing_interval, price_id,
      provider_status, provider_data, last_provider_event_at
    ) values (
      p_user_id, purchase.plan, case when purchase.provider_status in ('active', 'trialing') then 'active' else 'past_due' end,
      'paddle', purchase.paddle_customer_id, purchase.paddle_subscription_id,
      purchase.billing_interval, purchase.price_id, purchase.provider_status,
      purchase.provider_data, purchase.event_at
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
      update public.paddle_customers
      set user_id = p_user_id, updated_at = now()
      where paddle_customer_id = purchase.paddle_customer_id
        and (user_id is null or user_id = p_user_id);
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

 drop trigger if exists paddle_pending_purchases_set_updated_at on public.paddle_pending_purchases;
create trigger paddle_pending_purchases_set_updated_at
  before update on public.paddle_pending_purchases
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
