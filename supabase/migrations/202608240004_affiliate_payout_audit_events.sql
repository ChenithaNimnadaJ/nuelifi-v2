begin;

create table if not exists public.affiliate_payout_request_events (
  id uuid primary key default gen_random_uuid(),
  payout_request_id uuid not null references public.affiliate_payout_requests(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  payment_reference text,
  created_at timestamptz not null default now(),
  constraint affiliate_payout_request_events_type_check check (event_type in ('created', 'status_changed', 'notification_updated')),
  constraint affiliate_payout_request_events_from_status_check check (from_status is null or from_status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  constraint affiliate_payout_request_events_to_status_check check (to_status is null or to_status in ('pending', 'approved', 'paid', 'rejected', 'cancelled'))
);

create index if not exists affiliate_payout_request_events_request_idx
  on public.affiliate_payout_request_events (payout_request_id, created_at desc);

alter table public.affiliate_payout_request_events enable row level security;
revoke all on public.affiliate_payout_request_events from anon, authenticated;

create or replace function public.create_affiliate_payout_request(
  p_affiliate_id uuid,
  p_requested_amount numeric,
  p_request_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  method_row public.affiliate_payout_methods%rowtype;
  request_row public.affiliate_payout_requests%rowtype;
  available_rewards numeric(12, 6);
  reserved_payouts numeric(12, 6);
  eligible_balance numeric(12, 6);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  perform 1 from auth.users where id = p_affiliate_id for update;
  if not found then raise exception 'Affiliate account was not found'; end if;
  select * into method_row
    from public.affiliate_payout_methods
   where affiliate_id = p_affiliate_id and is_active
   order by updated_at desc
   limit 1
   for update;
  if method_row.id is null then raise exception 'Add a payout method before requesting a payout'; end if;
  if exists (select 1 from public.affiliate_payout_requests where affiliate_id = p_affiliate_id and status = 'pending') then
    raise exception 'A payout request is already pending';
  end if;
  select coalesce(sum(amount), 0) into available_rewards
    from public.referral_rewards where referrer_user_id = p_affiliate_id and status = 'available';
  select coalesce(sum(requested_amount), 0) into reserved_payouts
    from public.affiliate_payout_requests where affiliate_id = p_affiliate_id and status in ('pending', 'approved', 'paid');
  eligible_balance := greatest(0, available_rewards - reserved_payouts);
  if p_requested_amount is null or p_requested_amount < 5 then raise exception 'The minimum payout is $5.00'; end if;
  if p_requested_amount > eligible_balance then raise exception 'The requested amount exceeds your available balance'; end if;

  insert into public.affiliate_payout_requests (
    affiliate_id, payout_method_id, requested_amount, currency, available_balance_snapshot,
    method_type, method_currency, network, wallet_address_ciphertext, wallet_address_last4,
    memo_tag_ciphertext, request_note
  ) values (
    p_affiliate_id, method_row.id, round(p_requested_amount, 6), 'USD', eligible_balance,
    method_row.method_type, method_row.currency, method_row.network, method_row.wallet_address_ciphertext,
    method_row.wallet_address_last4, method_row.memo_tag_ciphertext, left(coalesce(p_request_note, ''), 500)
  ) returning * into request_row;

  insert into public.affiliate_payout_request_events (payout_request_id, actor_id, event_type, to_status, note)
  values (request_row.id, p_affiliate_id, 'created', request_row.status, request_row.request_note);

  return jsonb_build_object(
    'id', request_row.id,
    'affiliateId', request_row.affiliate_id,
    'requestedAmount', request_row.requested_amount,
    'currency', request_row.currency,
    'availableBalanceSnapshot', request_row.available_balance_snapshot,
    'status', request_row.status,
    'methodType', request_row.method_type,
    'methodCurrency', request_row.method_currency,
    'network', request_row.network,
    'walletAddressCiphertext', request_row.wallet_address_ciphertext,
    'walletAddressLast4', request_row.wallet_address_last4,
    'memoTagCiphertext', request_row.memo_tag_ciphertext,
    'createdAt', request_row.created_at,
    'notificationStatus', request_row.notification_status
  );
exception
  when unique_violation then
    raise exception 'A payout request is already pending';
end;
$$;

create or replace function public.mark_affiliate_payout_notification(
  p_request_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if p_status not in ('pending', 'sent', 'failed') then raise exception 'Invalid notification status'; end if;
  update public.affiliate_payout_requests
     set notification_status = p_status,
         notification_error = case when p_status = 'failed' then left(coalesce(p_error, 'Notification failed'), 500) else null end,
         notification_sent_at = case when p_status = 'sent' then now() else null end
   where id = p_request_id;
  if not found then raise exception 'Payout request was not found'; end if;
  insert into public.affiliate_payout_request_events (payout_request_id, actor_id, event_type, note)
  values (p_request_id, null, 'notification_updated', case when p_status = 'failed' then left(coalesce(p_error, 'Notification failed'), 500) else 'Notification sent' end);
end;
$$;

create or replace function public.update_affiliate_payout_request_status(
  p_request_id uuid,
  p_status text,
  p_reviewer_id uuid,
  p_admin_notes text default null,
  p_user_message text default null,
  p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.affiliate_payout_requests%rowtype;
  previous_status text;
  next_status text := lower(trim(coalesce(p_status, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if next_status not in ('approved', 'paid', 'rejected', 'cancelled') then raise exception 'Invalid payout status'; end if;
  select * into request_row from public.affiliate_payout_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'Payout request was not found'; end if;
  previous_status := request_row.status;
  if request_row.status in ('paid', 'rejected', 'cancelled') then raise exception 'That payout request is already closed'; end if;
  if request_row.status = 'pending' and next_status not in ('approved', 'rejected', 'cancelled') then raise exception 'Invalid payout status transition'; end if;
  if request_row.status = 'approved' and next_status not in ('paid', 'rejected') then raise exception 'Invalid payout status transition'; end if;
  if next_status = 'paid' and nullif(trim(coalesce(p_payment_reference, '')), '') is null then raise exception 'A payment reference is required before marking a request paid'; end if;

  update public.affiliate_payout_requests
     set status = next_status,
         reviewer_id = p_reviewer_id,
         reviewed_at = now(),
         admin_notes = left(nullif(trim(coalesce(p_admin_notes, '')), ''), 2000),
         user_message = left(nullif(trim(coalesce(p_user_message, '')), ''), 500),
         payment_reference = case when next_status = 'paid' then left(trim(p_payment_reference), 200) else payment_reference end,
         paid_by = case when next_status = 'paid' then p_reviewer_id else paid_by end,
         paid_at = case when next_status = 'paid' then now() else paid_at end
   where id = p_request_id
   returning * into request_row;

  insert into public.affiliate_payout_request_events (payout_request_id, actor_id, event_type, from_status, to_status, note, payment_reference)
  values (request_row.id, p_reviewer_id, 'status_changed', previous_status, next_status, coalesce(nullif(trim(p_admin_notes), ''), nullif(trim(p_user_message), '')), request_row.payment_reference);

  return jsonb_build_object(
    'id', request_row.id,
    'status', request_row.status,
    'reviewedAt', request_row.reviewed_at,
    'paidAt', request_row.paid_at,
    'paymentReference', request_row.payment_reference,
    'userMessage', request_row.user_message
  );
end;
$$;

revoke all on function public.create_affiliate_payout_request(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.mark_affiliate_payout_notification(uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_affiliate_payout_request_status(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_affiliate_payout_request(uuid, numeric, text) to service_role;
grant execute on function public.mark_affiliate_payout_notification(uuid, text, text) to service_role;
grant execute on function public.update_affiliate_payout_request_status(uuid, text, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
