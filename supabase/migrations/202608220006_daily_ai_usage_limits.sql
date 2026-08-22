alter table public.plan_catalog
  add column if not exists daily_ai_usage_limit integer;

update public.plan_catalog
set daily_ai_usage_limit = case id when 'free' then 2 when 'pro' then 3 when 'premium' then 5 else 2 end,
    ai_usage_limit = case id when 'free' then 2 when 'pro' then 3 when 'premium' then 5 else 2 end,
    updated_at = now();

alter table public.plan_catalog
  alter column daily_ai_usage_limit set not null;
alter table public.plan_catalog
  drop constraint if exists plan_catalog_daily_ai_usage_limit_check;
alter table public.plan_catalog
  add constraint plan_catalog_daily_ai_usage_limit_check check (daily_ai_usage_limit > 0);

drop function if exists public.reserve_ai_usage(uuid);
drop function if exists public.release_ai_usage(uuid);
drop function if exists public.current_ai_usage(uuid);

create function public.current_ai_usage(p_user_id uuid)
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
  day_start date := timezone('utc', now())::date;
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

  select pc.daily_ai_usage_limit, pc.analysis_level
    into current_limit, current_level
    from public.plan_catalog pc
   where pc.id = current_plan and pc.active = true;

  if current_limit is null then
    select pc.daily_ai_usage_limit, pc.analysis_level
      into current_limit, current_level
      from public.plan_catalog pc
     where pc.id = 'free';
    current_plan := 'free';
  end if;

  return query
  select current_plan,
         current_status,
         coalesce((select u.analyses_used from public.ai_usage u where u.user_id = p_user_id and u.period_start = day_start), 0),
         current_limit,
         current_level;
end;
$$;

create function public.reserve_ai_usage(p_user_id uuid)
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
  day_start date := timezone('utc', now())::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;

  select * into current_plan, current_status, current_used, current_limit, current_level
    from public.current_ai_usage(p_user_id);
  insert into public.ai_usage (user_id, period_start, analyses_used)
    values (p_user_id, day_start, 0)
    on conflict (user_id, period_start) do nothing;
  select u.analyses_used into current_used
    from public.ai_usage u
   where u.user_id = p_user_id and u.period_start = day_start
   for update;

  if current_used >= current_limit then
    return query select false, current_plan, current_status, current_used, current_limit, current_level;
    return;
  end if;

  update public.ai_usage
     set analyses_used = current_used + 1
   where user_id = p_user_id and period_start = day_start;
  return query select true, current_plan, current_status, current_used + 1, current_limit, current_level;
end;
$$;

create function public.release_ai_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  day_start date := timezone('utc', now())::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;
  update public.ai_usage
     set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user_id and period_start = day_start;
end;
$$;

revoke all on function public.current_ai_usage(uuid) from public, anon;
revoke all on function public.reserve_ai_usage(uuid) from public, anon;
revoke all on function public.release_ai_usage(uuid) from public, anon;
grant execute on function public.current_ai_usage(uuid) to authenticated;
grant execute on function public.reserve_ai_usage(uuid) to authenticated;
grant execute on function public.release_ai_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
