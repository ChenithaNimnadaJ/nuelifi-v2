create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.current_ai_usage(uuid) from public, anon;
revoke all on function public.reserve_ai_usage(uuid) from public, anon;
revoke all on function public.release_ai_usage(uuid) from public, anon;
grant execute on function public.current_ai_usage(uuid) to authenticated;
grant execute on function public.reserve_ai_usage(uuid) to authenticated;
grant execute on function public.release_ai_usage(uuid) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

comment on function public.current_ai_usage(uuid) is 'Returns the authenticated user’s current plan allowance and monthly AI usage.';
comment on function public.reserve_ai_usage(uuid) is 'Atomically reserves one authenticated user AI analysis allowance.';
comment on function public.release_ai_usage(uuid) is 'Releases one previously reserved authenticated user AI analysis allowance.';

revoke insert, update, delete on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

notify pgrst, 'reload schema';
