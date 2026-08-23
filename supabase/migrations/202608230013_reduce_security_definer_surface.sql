-- Read-only user-scoped RPCs rely on RLS and explicit auth.uid() checks.
-- Keep write-heavy/internal functions SECURITY DEFINER where they require controlled writes.
alter function public.current_ai_usage(uuid) security invoker;
alter function public.get_streak_snapshot(uuid) security invoker;
alter function public.get_referral_summary(uuid) security invoker;

revoke all on function public.current_ai_usage(uuid) from public, anon;
grant execute on function public.current_ai_usage(uuid) to authenticated;
revoke all on function public.get_streak_snapshot(uuid) from public, anon;
grant execute on function public.get_streak_snapshot(uuid) to authenticated;
revoke all on function public.get_referral_summary(uuid) from public, anon;
grant execute on function public.get_referral_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
