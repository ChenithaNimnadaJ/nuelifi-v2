create table if not exists public.paddle_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  paddle_customer_id text not null unique,
  email text,
  name text,
  locale text,
  status text,
  marketing_consent boolean,
  custom_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions add column if not exists provider text;
alter table public.subscriptions add column if not exists billing_interval text;
alter table public.subscriptions add column if not exists price_id text;
alter table public.subscriptions add column if not exists provider_status text;
alter table public.subscriptions add column if not exists current_billing_period jsonb;
alter table public.subscriptions add column if not exists scheduled_change jsonb;
alter table public.subscriptions add column if not exists provider_data jsonb not null default '{}'::jsonb;
alter table public.subscriptions add column if not exists last_provider_event_at timestamptz;

create index if not exists paddle_customers_user_id_idx on public.paddle_customers(user_id);
create index if not exists paddle_customers_last_event_at_idx on public.paddle_customers(last_event_at desc);
create unique index if not exists subscriptions_provider_subscription_id_key
  on public.subscriptions(provider_subscription_id)
  where provider_subscription_id is not null;
create index if not exists subscriptions_provider_customer_id_idx
  on public.subscriptions(provider_customer_id)
  where provider_customer_id is not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_interval_check;
alter table public.subscriptions
  add constraint subscriptions_billing_interval_check
  check (billing_interval is null or billing_interval in ('month', 'year'));

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists paddle_customers_set_updated_at on public.paddle_customers;
create trigger paddle_customers_set_updated_at
  before update on public.paddle_customers
  for each row execute function public.set_updated_at();

alter table public.paddle_customers enable row level security;
revoke all on public.paddle_customers from anon, authenticated;

notify pgrst, 'reload schema';
