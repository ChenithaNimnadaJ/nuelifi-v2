begin;

create table if not exists public.affiliate_payout_method_options (
  method_type text not null,
  currency text not null,
  network text not null,
  display_name text not null default 'Crypto transfer',
  memo_required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (method_type, currency, network),
  constraint affiliate_payout_method_options_type_check check (method_type in ('crypto_transfer')),
  constraint affiliate_payout_method_options_currency_check check (currency = upper(currency)),
  constraint affiliate_payout_method_options_network_check check (network = upper(network))
);

insert into public.affiliate_payout_method_options (method_type, currency, network, display_name, memo_required)
values ('crypto_transfer', 'USDT', 'TRC20', 'Crypto transfer', false)
on conflict (method_type, currency, network) do nothing;

create table if not exists public.affiliate_payout_methods (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references auth.users(id) on delete cascade,
  method_type text not null,
  currency text not null,
  network text not null,
  wallet_address_ciphertext text not null,
  wallet_address_last4 text not null,
  memo_tag_ciphertext text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_payout_methods_last4_check check (wallet_address_last4 ~ '^[A-Za-z0-9]{4}$')
);

create unique index if not exists affiliate_payout_methods_one_active_idx
  on public.affiliate_payout_methods (affiliate_id)
  where is_active;
create index if not exists affiliate_payout_methods_affiliate_idx
  on public.affiliate_payout_methods (affiliate_id, is_active, updated_at desc);

create table if not exists public.affiliate_payout_requests (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references auth.users(id) on delete restrict,
  payout_method_id uuid not null references public.affiliate_payout_methods(id) on delete restrict,
  requested_amount numeric(12, 6) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  available_balance_snapshot numeric(12, 6) not null,
  method_type text not null,
  method_currency text not null,
  network text not null,
  wallet_address_ciphertext text not null,
  wallet_address_last4 text not null,
  memo_tag_ciphertext text,
  request_note text not null default '',
  admin_notes text,
  user_message text,
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  payment_reference text,
  notification_status text not null default 'pending',
  notification_error text,
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_payout_requests_amount_check check (requested_amount >= 0),
  constraint affiliate_payout_requests_balance_check check (available_balance_snapshot >= 0),
  constraint affiliate_payout_requests_currency_check check (currency = 'USD'),
  constraint affiliate_payout_requests_status_check check (status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  constraint affiliate_payout_requests_notification_check check (notification_status in ('pending', 'sent', 'failed')),
  constraint affiliate_payout_requests_last4_check check (wallet_address_last4 ~ '^[A-Za-z0-9]{4}$')
);

create unique index if not exists affiliate_payout_requests_one_pending_idx
  on public.affiliate_payout_requests (affiliate_id)
  where status = 'pending';
create index if not exists affiliate_payout_requests_affiliate_idx
  on public.affiliate_payout_requests (affiliate_id, created_at desc);
create index if not exists affiliate_payout_requests_status_idx
  on public.affiliate_payout_requests (status, created_at desc);

create or replace function public.affiliate_payout_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists affiliate_payout_method_options_updated_at on public.affiliate_payout_method_options;
create trigger affiliate_payout_method_options_updated_at
before update on public.affiliate_payout_method_options
for each row execute function public.affiliate_payout_updated_at();
drop trigger if exists affiliate_payout_methods_updated_at on public.affiliate_payout_methods;
create trigger affiliate_payout_methods_updated_at
before update on public.affiliate_payout_methods
for each row execute function public.affiliate_payout_updated_at();
drop trigger if exists affiliate_payout_requests_updated_at on public.affiliate_payout_requests;
create trigger affiliate_payout_requests_updated_at
before update on public.affiliate_payout_requests
for each row execute function public.affiliate_payout_updated_at();

alter table public.affiliate_payout_method_options enable row level security;
alter table public.affiliate_payout_methods enable row level security;
alter table public.affiliate_payout_requests enable row level security;

drop policy if exists affiliate_payout_methods_owner_read on public.affiliate_payout_methods;
create policy affiliate_payout_methods_owner_read on public.affiliate_payout_methods
for select using ((select auth.uid()) = affiliate_id);
drop policy if exists affiliate_payout_requests_owner_read on public.affiliate_payout_requests;
create policy affiliate_payout_requests_owner_read on public.affiliate_payout_requests
for select using ((select auth.uid()) = affiliate_id);

drop policy if exists affiliate_payout_method_options_private on public.affiliate_payout_method_options;
create policy affiliate_payout_method_options_private on public.affiliate_payout_method_options
for select using (false);

revoke all on public.affiliate_payout_method_options from anon, authenticated;
revoke all on public.affiliate_payout_methods from anon, authenticated;
revoke all on public.affiliate_payout_requests from anon, authenticated;

create or replace function public.get_referral_summary(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_value text;
  referred_count integer;
  paid_count integer;
  paid_this_month integer;
  scans integer;
  pending numeric(12, 6);
  available_rewards numeric(12, 6);
  reserved_payouts numeric(12, 6);
  available numeric(12, 6);
  lifetime numeric(12, 6);
  standard_pro numeric(12, 6);
  standard_premium numeric(12, 6);
  high_volume_pro numeric(12, 6);
  high_volume_premium numeric(12, 6);
  high_volume_threshold integer;
  current_month_start timestamptz := date_trunc('month', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'Not allowed';
  end if;

  select code into code_value from public.referral_codes where user_id = p_user_id and active = true limit 1;
  select count(*)::integer into referred_count from public.referrals where referrer_user_id = p_user_id;
  select count(distinct referred_user_id)::integer into paid_count
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'paid_subscription' and status <> 'reversed';
  select count(distinct referred_user_id)::integer into paid_this_month
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'paid_subscription' and status <> 'reversed'
     and created_at >= current_month_start and created_at < current_month_start + interval '1 month';
  select count(*)::integer into scans
    from public.referral_rewards
   where referrer_user_id = p_user_id and reward_type = 'meal_scan' and status <> 'reversed';
  select coalesce(sum(amount) filter (where status = 'pending'), 0),
         coalesce(sum(amount) filter (where status = 'available'), 0),
         coalesce(sum(amount) filter (where status <> 'reversed'), 0)
    into pending, available_rewards, lifetime
    from public.referral_rewards where referrer_user_id = p_user_id;
  select coalesce(sum(requested_amount) filter (where status in ('pending', 'approved', 'paid')), 0)
    into reserved_payouts
    from public.affiliate_payout_requests where affiliate_id = p_user_id;
  available := greatest(0, available_rewards - reserved_payouts);
  select coalesce(setting_value, 1) into standard_pro from public.referral_settings where setting_key = 'paid_pro_reward';
  select coalesce(setting_value, 3) into standard_premium from public.referral_settings where setting_key = 'paid_premium_reward';
  select coalesce(setting_value, 2) into high_volume_pro from public.referral_settings where setting_key = 'paid_pro_high_volume_reward';
  select coalesce(setting_value, 5) into high_volume_premium from public.referral_settings where setting_key = 'paid_premium_high_volume_reward';
  select coalesce(round(setting_value)::integer, 100) into high_volume_threshold from public.referral_settings where setting_key = 'paid_high_volume_threshold';

  return jsonb_build_object(
    'code', code_value,
    'referredUsers', referred_count,
    'paidUsers', paid_count,
    'paidUsersThisMonth', paid_this_month,
    'referredScans', scans,
    'pendingEarnings', pending,
    'availableEarnings', available,
    'rewardAvailableEarnings', available_rewards,
    'reservedPayouts', reserved_payouts,
    'lifetimeEarnings', lifetime,
    'standardProCommission', standard_pro,
    'standardPremiumCommission', standard_premium,
    'highVolumeProCommission', high_volume_pro,
    'highVolumePremiumCommission', high_volume_premium,
    'highVolumeThreshold', high_volume_threshold
  );
end;
$$;

create or replace function public.save_affiliate_payout_method(
  p_affiliate_id uuid,
  p_method_type text,
  p_currency text,
  p_network text,
  p_wallet_address_ciphertext text,
  p_wallet_address_last4 text,
  p_memo_tag_ciphertext text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_method public.affiliate_payout_methods%rowtype;
  normalized_type text := lower(trim(coalesce(p_method_type, '')));
  normalized_currency text := upper(trim(coalesce(p_currency, '')));
  normalized_network text := upper(trim(coalesce(p_network, '')));
  normalized_last4 text := upper(trim(coalesce(p_wallet_address_last4, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  if not exists (
    select 1 from public.affiliate_payout_method_options
     where method_type = normalized_type and currency = normalized_currency and network = normalized_network and active
  ) then
    raise exception 'Unsupported payout method';
  end if;
  if p_wallet_address_ciphertext is null or length(p_wallet_address_ciphertext) < 20 or length(p_wallet_address_ciphertext) > 5000 then
    raise exception 'Payout method data is invalid';
  end if;
  if normalized_last4 !~ '^[A-Z0-9]{4}$' then raise exception 'Payout method data is invalid'; end if;

  update public.affiliate_payout_methods
     set is_active = false
   where affiliate_id = p_affiliate_id and is_active;
  insert into public.affiliate_payout_methods (
    affiliate_id, method_type, currency, network, wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext
  ) values (
    p_affiliate_id, normalized_type, normalized_currency, normalized_network, p_wallet_address_ciphertext, normalized_last4, p_memo_tag_ciphertext
  ) returning * into new_method;
  return jsonb_build_object(
    'id', new_method.id,
    'methodType', new_method.method_type,
    'currency', new_method.currency,
    'network', new_method.network,
    'walletAddressLast4', new_method.wallet_address_last4,
    'hasMemoTag', new_method.memo_tag_ciphertext is not null,
    'createdAt', new_method.created_at,
    'updatedAt', new_method.updated_at
  );
end;
$$;

create or replace function public.remove_affiliate_payout_method(p_affiliate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  update public.affiliate_payout_methods
     set is_active = false
   where affiliate_id = p_affiliate_id and is_active;
  get diagnostics changed = row_count;
  return jsonb_build_object('removed', changed > 0, 'pendingRequestsPreserved', true);
end;
$$;

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
  next_status text := lower(trim(coalesce(p_status, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if next_status not in ('approved', 'paid', 'rejected', 'cancelled') then raise exception 'Invalid payout status'; end if;
  select * into request_row from public.affiliate_payout_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'Payout request was not found'; end if;
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

revoke all on function public.get_referral_summary(uuid) from public, anon, authenticated;
revoke all on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_affiliate_payout_method(uuid) from public, anon, authenticated;
revoke all on function public.create_affiliate_payout_request(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.mark_affiliate_payout_notification(uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_affiliate_payout_request_status(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.get_referral_summary(uuid) to service_role;
grant execute on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.remove_affiliate_payout_method(uuid) to service_role;
grant execute on function public.create_affiliate_payout_request(uuid, numeric, text) to service_role;
grant execute on function public.mark_affiliate_payout_notification(uuid, text, text) to service_role;
grant execute on function public.update_affiliate_payout_request_status(uuid, text, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
