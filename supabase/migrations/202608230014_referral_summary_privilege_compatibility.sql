-- referral_settings is intentionally hidden from direct authenticated reads.
-- Keep the summary function privileged but ownership-checked to expose only the aggregate result.
alter function public.get_referral_summary(uuid) security definer;
revoke all on function public.get_referral_summary(uuid) from public, anon;
grant execute on function public.get_referral_summary(uuid) to authenticated;
notify pgrst, 'reload schema';
