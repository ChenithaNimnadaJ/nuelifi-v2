alter table public.plan_catalog
  add column if not exists annual_price numeric;

update public.plan_catalog
set annual_price = case id when 'free' then null when 'pro' then 10 when 'premium' then 30 end,
    price = case id when 'free' then null when 'pro' then 10 when 'premium' then 30 end,
    price_label = case id when 'free' then 'Free' when 'pro' then '$10 / year' when 'premium' then '$30 / year' end,
    billing_interval = case id when 'free' then 'lifetime' else 'year' end,
    updated_at = now();

notify pgrst, 'reload schema';
