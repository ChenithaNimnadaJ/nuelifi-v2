drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
for all
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists meals_owner on public.meals;
create policy meals_owner on public.meals
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists meal_analyses_owner on public.meal_analyses;
create policy meal_analyses_owner on public.meal_analyses
for all
using (exists (select 1 from public.meals where meals.id = meal_analyses.meal_id and meals.user_id = (select auth.uid())))
with check (exists (select 1 from public.meals where meals.id = meal_analyses.meal_id and meals.user_id = (select auth.uid())));

drop policy if exists actions_owner on public.actions;
create policy actions_owner on public.actions
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists subscriptions_owner on public.subscriptions;
create policy subscriptions_owner on public.subscriptions
for select
using ((select auth.uid()) = user_id);

drop policy if exists ai_usage_owner_read on public.ai_usage;
create policy ai_usage_owner_read on public.ai_usage
for select
using ((select auth.uid()) = user_id);

create index if not exists actions_meal_id_idx on public.actions(meal_id);
create index if not exists subscriptions_plan_idx on public.subscriptions(plan);
drop index if exists public.ai_usage_period_idx;

notify pgrst, 'reload schema';
