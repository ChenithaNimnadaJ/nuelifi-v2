begin;

drop function if exists public.mark_affiliate_payout_notification(uuid, text, text);
alter table public.affiliate_payout_requests
  drop constraint if exists affiliate_payout_requests_notification_check,
  drop column if exists notification_status,
  drop column if exists notification_error,
  drop column if exists notification_sent_at;

notify pgrst, 'reload schema';
commit;
