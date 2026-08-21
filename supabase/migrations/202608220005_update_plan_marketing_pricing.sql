alter table public.plan_catalog
  add column if not exists annual_price numeric,
  add column if not exists annual_price_label text not null default '';

update public.plan_catalog
set
  description = 'A simple starting point for building a healthier daily rhythm.',
  price = null,
  price_label = 'Free',
  annual_price = null,
  annual_price_label = 'Free forever',
  ai_usage_limit = 5,
  analysis_level = 'basic',
  updated_at = now()
where id = 'free';

update public.plan_catalog
set
  description = 'More room to understand patterns and keep your momentum going.',
  price = 1,
  price_label = '$1 / month',
  annual_price = 10,
  annual_price_label = '$10 / year',
  ai_usage_limit = 25,
  analysis_level = 'enhanced',
  updated_at = now()
where id = 'pro';

update public.plan_catalog
set
  description = 'The complete Nuelifi experience for a deeper view of your health rhythm.',
  price = 3,
  price_label = '$3 / month',
  annual_price = 30,
  annual_price_label = '$30 / year',
  ai_usage_limit = 250,
  analysis_level = 'complete',
  updated_at = now()
where id = 'premium';

notify pgrst, 'reload schema';
