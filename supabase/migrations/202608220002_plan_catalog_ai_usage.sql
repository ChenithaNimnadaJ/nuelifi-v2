create table if not exists public.plan_catalog (
  id text primary key check (id in ('free', 'pro', 'premium')),
  name text not null,
  description text not null default '',
  price numeric,
  price_label text not null,
  billing_interval text not null default 'month',
  display_order integer not null default 1,
  active boolean not null default true,
  ai_usage_limit integer not null check (ai_usage_limit > 0),
  analysis_level text not null check (analysis_level in ('basic', 'enhanced', 'complete')),
  capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plan_catalog (id, name, description, price, price_label, billing_interval, display_order, active, ai_usage_limit, analysis_level, capabilities)
values
  ('free', 'Free', 'A calm starting point for everyday meal and habit awareness.', null, 'Free', 'month', 1, true, 5, 'basic', '["meal_analysis", "condition_aware_guidance", "daily_tasks", "meal_history"]'::jsonb),
  ('pro', 'Pro', 'More room for consistent tracking and deeper everyday guidance.', null, 'Billing not connected', 'month', 2, true, 25, 'enhanced', '["meal_analysis", "condition_aware_guidance", "daily_tasks", "meal_history", "enhanced_analysis"]'::jsonb),
  ('premium', 'Premium', 'The fullest analysis experience for people who want more context over time.', null, 'Billing not connected', 'month', 3, true, 50, 'complete', '["meal_analysis", "condition_aware_guidance", "daily_tasks", "meal_history", "enhanced_analysis", "complete_analysis"]'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  price_label = excluded.price_label,
  billing_interval = excluded.billing_interval,
  display_order = excluded.display_order,
  active = excluded.active,
  ai_usage_limit = excluded.ai_usage_limit,
  analysis_level = excluded.analysis_level,
  capabilities = excluded.capabilities,
  updated_at = now();

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('free', 'pro', 'premium'));
alter table public.subscriptions drop constraint if exists subscriptions_plan_catalog_fkey;
alter table public.subscriptions add constraint subscriptions_plan_catalog_fkey foreign key (plan) references public.plan_catalog(id);

drop trigger if exists plan_catalog_set_updated_at on public.plan_catalog;
create trigger plan_catalog_set_updated_at before update on public.plan_catalog for each row execute function public.set_updated_at();

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  analyses_used integer not null default 0 check (analyses_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

create index if not exists ai_usage_period_idx on public.ai_usage(period_start, user_id);

drop trigger if exists ai_usage_set_updated_at on public.ai_usage;
create trigger ai_usage_set_updated_at before update on public.ai_usage for each row execute function public.set_updated_at();

alter table public.plan_catalog enable row level security;
drop policy if exists plan_catalog_public_read on public.plan_catalog;
create policy plan_catalog_public_read on public.plan_catalog for select using (active = true);

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_owner_read on public.ai_usage;
create policy ai_usage_owner_read on public.ai_usage for select using (auth.uid() = user_id);

create or replace function public.current_ai_usage(p_user_id uuid)
returns table (plan text, status text, used integer, usage_limit integer, analysis_level text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_plan text;
  current_status text;
  current_limit integer;
  current_level text;
  month_start date := date_trunc('month', timezone('utc', now()))::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;

  select coalesce(s.plan, 'free'), coalesce(s.status, 'active')
    into current_plan, current_status
    from public.subscriptions s
   where s.user_id = p_user_id
   limit 1;

  if current_status <> 'active' then current_plan := 'free'; end if;

  select pc.ai_usage_limit, pc.analysis_level
    into current_limit, current_level
    from public.plan_catalog pc
   where pc.id = current_plan and pc.active = true;

  if current_limit is null then
    select pc.ai_usage_limit, pc.analysis_level into current_limit, current_level from public.plan_catalog pc where pc.id = 'free';
    current_plan := 'free';
  end if;

  return query
  select current_plan, current_status, coalesce((select u.analyses_used from public.ai_usage u where u.user_id = p_user_id and u.period_start = month_start), 0), current_limit, current_level;
end;
$$;

create or replace function public.reserve_ai_usage(p_user_id uuid)
returns table (allowed boolean, plan text, status text, used integer, usage_limit integer, analysis_level text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_plan text;
  current_status text;
  current_limit integer;
  current_level text;
  current_used integer;
  month_start date := date_trunc('month', timezone('utc', now()))::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;

  select * into current_plan, current_status, current_used, current_limit, current_level from public.current_ai_usage(p_user_id);
  insert into public.ai_usage (user_id, period_start, analyses_used) values (p_user_id, month_start, 0) on conflict (user_id, period_start) do nothing;
  select u.analyses_used into current_used from public.ai_usage u where u.user_id = p_user_id and u.period_start = month_start for update;

  if current_used >= current_limit then
    return query select false, current_plan, current_status, current_used, current_limit, current_level;
    return;
  end if;

  update public.ai_usage set analyses_used = current_used + 1 where user_id = p_user_id and period_start = month_start;
  return query select true, current_plan, current_status, current_used + 1, current_limit, current_level;
end;
$$;

create or replace function public.release_ai_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  month_start date := date_trunc('month', timezone('utc', now()))::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;
  update public.ai_usage set analyses_used = greatest(analyses_used - 1, 0) where user_id = p_user_id and period_start = month_start;
end;
$$;

grant select on public.plan_catalog to anon, authenticated;
grant select on public.ai_usage to authenticated;
grant execute on function public.current_ai_usage(uuid) to authenticated;
grant execute on function public.reserve_ai_usage(uuid) to authenticated;
grant execute on function public.release_ai_usage(uuid) to authenticated;
revoke insert, update, delete on public.ai_usage from anon, authenticated;
