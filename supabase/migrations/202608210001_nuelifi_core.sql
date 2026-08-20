create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  goals jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  meal_name text not null default 'Meal',
  status text not null default 'analysed' check (status in ('pending', 'analysed', 'failed')),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meal_analyses (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null unique references public.meals(id) on delete cascade,
  rating text not null check (rating in ('Excellent', 'Good', 'Reasonable', 'Needs Adjustment')),
  score integer not null check (score between 0 and 100),
  indicators jsonb not null default '{}'::jsonb,
  explanation text not null default '',
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete set null,
  title text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meals_user_id_captured_at_idx on public.meals(user_id, captured_at desc);
create index if not exists actions_user_id_completed_idx on public.actions(user_id, completed);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.meal_analyses enable row level security;
alter table public.actions enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists meals_owner on public.meals;
create policy meals_owner on public.meals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists meal_analyses_owner on public.meal_analyses;
create policy meal_analyses_owner on public.meal_analyses for all using (exists (select 1 from public.meals where meals.id = meal_analyses.meal_id and meals.user_id = auth.uid())) with check (exists (select 1 from public.meals where meals.id = meal_analyses.meal_id and meals.user_id = auth.uid()));
drop policy if exists actions_owner on public.actions;
create policy actions_owner on public.actions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists subscriptions_owner on public.subscriptions;
create policy subscriptions_owner on public.subscriptions for select using (auth.uid() = user_id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', '')) on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
