alter table public.meal_analyses
  add column if not exists meal_guidance jsonb not null default '[]'::jsonb;

alter table public.meal_analyses
  add column if not exists daily_tasks jsonb not null default '[]'::jsonb;
