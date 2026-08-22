-- Keep internal activity, referral, and meal persistence functions out of the browser-callable API.
revoke all on function public.record_qualifying_activity(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_activity_internal(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.refresh_neulifi_score(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_referral_scan(uuid, text) from public, anon, authenticated;
revoke all on function public.record_paid_referral_reward(uuid, text, text) from public, anon, authenticated;
revoke all on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;

grant execute on function public.record_referral_scan(uuid, text) to service_role;
grant execute on function public.record_paid_referral_reward(uuid, text, text) to service_role;
grant execute on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb) to service_role;

notify pgrst, 'reload schema';
