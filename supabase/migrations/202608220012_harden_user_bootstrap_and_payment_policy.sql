create or replace function public.ensure_user_records(p_user_id uuid, p_name text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not allowed';
  end if;

  insert into public.profiles (id, name)
  values (p_user_id, left(coalesce(p_name, ''), 120))
  on conflict (id) do update
    set name = case
      when public.profiles.name = '' and excluded.name <> '' then excluded.name
      else public.profiles.name
    end;

  insert into public.subscriptions (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.ensure_user_records(uuid, text) from public, anon;
grant execute on function public.ensure_user_records(uuid, text) to authenticated;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

 drop policy if exists payment_events_service_role_only on public.payment_events;
create policy payment_events_service_role_only on public.payment_events
  for all to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
