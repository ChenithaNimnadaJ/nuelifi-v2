create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_code text;
  next_code text;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not allowed'; end if;
  select code into existing_code from public.referral_codes where user_id = p_user_id and active = true;
  if existing_code is not null then return existing_code; end if;
  loop
    next_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.referral_codes where code = next_code);
  end loop;
  insert into public.referral_codes (user_id, code) values (p_user_id, next_code);
  return next_code;
end;
$$;

revoke all on function public.ensure_referral_code(uuid) from public, anon;
grant execute on function public.ensure_referral_code(uuid) to authenticated;

notify pgrst, 'reload schema';
