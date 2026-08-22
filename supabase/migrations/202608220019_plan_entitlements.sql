-- Make plan entitlements explicit and enforce Premium leaderboard access server-side.
update public.plan_catalog
set capabilities = case
  when capabilities ? 'referral_rewards' then capabilities
  else capabilities || '["referral_rewards"]'::jsonb
end,
updated_at = now()
where id in ('free', 'pro', 'premium');

update public.plan_catalog
set capabilities = case
  when capabilities ? 'leaderboard_access' then capabilities
  else capabilities || '["leaderboard_access"]'::jsonb
end,
updated_at = now()
where id = 'premium';

create or replace function public.get_leaderboard(p_user_id uuid)
returns table (rank bigint, user_id uuid, display_name text, score integer, is_current boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.subscriptions s
    where s.user_id = auth.uid()
      and s.plan = 'premium'
      and s.status = 'active'
  ) then
    raise exception 'Premium leaderboard access required';
  end if;

  return query
  with ranked as (
    select row_number() over (order by p.neulifi_score desc, p.updated_at asc, p.id) as rank,
           p.id as user_id,
           coalesce(nullif(left(p.name, 60), ''), 'Neulifi member') as display_name,
           p.neulifi_score as score
      from public.profiles p
     where p.leaderboard_opt_in = true
       and exists (
         select 1
         from public.subscriptions member_subscription
         where member_subscription.user_id = p.id
           and member_subscription.plan = 'premium'
           and member_subscription.status = 'active'
       )
  )
  select r.rank, r.user_id, r.display_name, r.score, r.user_id = p_user_id
    from ranked r
   where r.rank <= 10 or r.user_id = p_user_id
   order by r.rank;
end;
$$;

revoke execute on function public.get_leaderboard(uuid) from public, anon;
grant execute on function public.get_leaderboard(uuid) to authenticated;

notify pgrst, 'reload schema';
