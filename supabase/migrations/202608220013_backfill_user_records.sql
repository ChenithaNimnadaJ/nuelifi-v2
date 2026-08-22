insert into public.profiles (id, name)
select u.id, left(coalesce(u.raw_user_meta_data ->> 'name', ''), 120)
from auth.users u
on conflict (id) do nothing;

insert into public.subscriptions (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;
