begin;

-- Crypto transfer is the only supported affiliate payout method. Fail closed if
-- any live payout records already use a method that this migration would remove.
do $$
begin
  if exists (
    select 1
      from public.affiliate_payout_methods
     where method_type <> 'crypto_transfer'
  ) then
    raise exception 'Cannot apply crypto-only payout migration: unsupported active payout method records exist';
  end if;
  if exists (
    select 1
      from public.affiliate_payout_requests
     where method_type <> 'crypto_transfer'
  ) then
    raise exception 'Cannot apply crypto-only payout migration: unsupported payout request records exist';
  end if;
end;
$$;

-- Remove unsupported configuration rows. These are configuration records, not
-- accounting records, and are safe to remove after the fail-closed checks above.
delete from public.affiliate_payout_country_methods
 where method_type <> 'crypto_transfer';
delete from public.affiliate_payout_method_options
 where method_type <> 'crypto_transfer';

alter table public.affiliate_payout_method_options
  drop constraint if exists affiliate_payout_method_options_type_check;
alter table public.affiliate_payout_method_options
  add constraint affiliate_payout_method_options_type_check
  check (method_type = 'crypto_transfer');

alter table public.affiliate_payout_methods
  drop constraint if exists affiliate_payout_methods_type_check;
alter table public.affiliate_payout_methods
  add constraint affiliate_payout_methods_type_check
  check (method_type = 'crypto_transfer');

alter table public.affiliate_payout_requests
  drop constraint if exists affiliate_payout_requests_method_type_check;
alter table public.affiliate_payout_requests
  add constraint affiliate_payout_requests_method_type_check
  check (method_type = 'crypto_transfer');

-- Restore the crypto-only invariants that were relaxed for the earlier
-- country-aware multi-method implementation.
alter table public.affiliate_payout_methods
  alter column wallet_address_ciphertext set not null,
  alter column wallet_address_last4 set not null;
alter table public.affiliate_payout_requests
  alter column wallet_address_ciphertext set not null,
  alter column wallet_address_last4 set not null;

-- The active model stores only crypto destination data. Preserve the masked
-- destination preview used by the UI and remove unsupported destination fields.
alter table public.affiliate_payout_methods
  drop column if exists paypal_email_ciphertext,
  drop column if exists other_details_ciphertext;
alter table public.affiliate_payout_requests
  drop column if exists paypal_email_ciphertext,
  drop column if exists other_details_ciphertext;

-- Remove the earlier country-aware function overloads before installing the
-- crypto-only contracts. The old signatures accepted unsupported destination
-- fields and must not remain callable.
drop function if exists public.save_affiliate_payout_method(uuid, text, text, text, text, text, text);
drop function if exists public.save_affiliate_payout_method(uuid, text, text, text, text, text, text, text, text, text, text);

create or replace function public.save_affiliate_payout_method(
  p_affiliate_id uuid,
  p_country_code text,
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
  normalized_country text := upper(trim(coalesce(p_country_code, '')));
  normalized_type text := lower(trim(coalesce(p_method_type, '')));
  normalized_currency text := upper(trim(coalesce(p_currency, '')));
  normalized_network text := upper(trim(coalesce(p_network, '')));
  normalized_last4 text := upper(trim(coalesce(p_wallet_address_last4, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  if normalized_country !~ '^[A-Z]{2}$' then
    raise exception 'Enter a valid two-letter country code';
  end if;
  if normalized_type <> 'crypto_transfer' then
    raise exception 'Unsupported payout method';
  end if;
  if not exists (
    select 1
      from public.affiliate_payout_method_options
     where method_type = 'crypto_transfer'
       and currency = normalized_currency
       and network = normalized_network
       and active
  ) then
    raise exception 'Unsupported cryptocurrency or network';
  end if;
  if not exists (
    select 1
      from public.affiliate_payout_country_methods cm
     where cm.active
       and (cm.country_code = normalized_country or cm.country_code = 'GLOBAL')
       and cm.method_type = 'crypto_transfer'
       and cm.currency = normalized_currency
       and cm.network = normalized_network
  ) then
    raise exception 'That crypto payout option is not configured for this country';
  end if;
  if p_wallet_address_ciphertext is null
     or length(p_wallet_address_ciphertext) < 20
     or length(p_wallet_address_ciphertext) > 5000 then
    raise exception 'Payout method data is invalid';
  end if;
  if normalized_last4 !~ '^[A-Z0-9]{4}$' then
    raise exception 'Payout method data is invalid';
  end if;
  if exists (
    select 1
      from public.affiliate_payout_method_options
     where method_type = 'crypto_transfer'
       and currency = normalized_currency
       and network = normalized_network
       and memo_required
  ) and p_memo_tag_ciphertext is null then
    raise exception 'A memo or tag is required for this crypto payout option';
  end if;

  update public.affiliate_payout_methods
     set is_active = false
   where affiliate_id = p_affiliate_id and is_active;
  insert into public.affiliate_payout_methods (
    affiliate_id, country_code, method_type, currency, network,
    wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext,
    destination_preview, destination_last4
  ) values (
    p_affiliate_id, normalized_country, 'crypto_transfer', normalized_currency, normalized_network,
    p_wallet_address_ciphertext, normalized_last4, p_memo_tag_ciphertext,
    left('Wallet ending ••••' || normalized_last4, 320), normalized_last4
  ) returning * into new_method;

  return jsonb_build_object(
    'id', new_method.id,
    'countryCode', new_method.country_code,
    'methodType', new_method.method_type,
    'currency', new_method.currency,
    'network', new_method.network,
    'destinationPreview', new_method.destination_preview,
    'destinationLast4', new_method.destination_last4,
    'hasMemoTag', new_method.memo_tag_ciphertext is not null,
    'createdAt', new_method.created_at,
    'updatedAt', new_method.updated_at
  );
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
  affiliate_email text;
  affiliate_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  select u.email, coalesce(nullif(p.name, ''), nullif(u.raw_user_meta_data ->> 'name', ''), '')
    into affiliate_email, affiliate_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_affiliate_id;
  if affiliate_email is null and affiliate_name is null then
    raise exception 'Affiliate account was not found';
  end if;
  perform 1 from auth.users where id = p_affiliate_id for update;
  select * into method_row
    from public.affiliate_payout_methods
   where affiliate_id = p_affiliate_id and is_active
     and method_type = 'crypto_transfer'
   order by updated_at desc
   limit 1
   for update;
  if method_row.id is null then
    raise exception 'Add a crypto payout method before requesting a payout';
  end if;
  if exists (
    select 1
      from public.affiliate_payout_requests
     where affiliate_id = p_affiliate_id and status = 'pending'
  ) then
    raise exception 'A payout request is already pending';
  end if;
  select coalesce(sum(amount), 0)
    into available_rewards
    from public.referral_rewards
   where referrer_user_id = p_affiliate_id and status = 'available';
  select coalesce(sum(requested_amount), 0)
    into reserved_payouts
    from public.affiliate_payout_requests
   where affiliate_id = p_affiliate_id and status in ('pending', 'approved', 'paid');
  eligible_balance := greatest(0, available_rewards - reserved_payouts);
  if p_requested_amount is null or p_requested_amount < 5 then
    raise exception 'The minimum payout is $5.00';
  end if;
  if p_requested_amount > eligible_balance then
    raise exception 'The requested amount exceeds your available balance';
  end if;

  insert into public.affiliate_payout_requests (
    affiliate_id, affiliate_name, affiliate_email, payout_method_id, country_code,
    requested_amount, currency, available_balance_snapshot,
    method_type, method_currency, network,
    wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext,
    destination_preview, destination_last4, request_note
  ) values (
    p_affiliate_id, left(coalesce(affiliate_name, ''), 120), left(affiliate_email, 320), method_row.id, method_row.country_code,
    round(p_requested_amount, 6), 'USD', eligible_balance,
    'crypto_transfer', method_row.currency, method_row.network,
    method_row.wallet_address_ciphertext, method_row.wallet_address_last4, method_row.memo_tag_ciphertext,
    method_row.destination_preview, method_row.destination_last4, left(coalesce(p_request_note, ''), 500)
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
    'countryCode', request_row.country_code,
    'methodType', 'crypto_transfer',
    'methodCurrency', request_row.method_currency,
    'network', request_row.network,
    'destinationPreview', request_row.destination_preview,
    'destinationLast4', request_row.destination_last4,
    'hasMemoTag', request_row.memo_tag_ciphertext is not null,
    'userMessage', null,
    'createdAt', request_row.created_at,
    'reviewedAt', null,
    'paidAt', null,
    'paymentReference', null
  );
exception
  when unique_violation then
    raise exception 'A payout request is already pending';
end;
$$;

create or replace function public.list_affiliate_payout_requests_admin(
  p_status text default '',
  p_search text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_list jsonb;
  pending_count integer;
  pending_amount numeric(12, 6);
  paid_count integer;
  paid_amount numeric(12, 6);
  normalized_status text := lower(trim(coalesce(p_status, '')));
  normalized_search text := lower(trim(coalesce(p_search, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if normalized_status <> ''
     and normalized_status not in ('pending', 'approved', 'paid', 'rejected', 'cancelled') then
    raise exception 'Invalid payout status';
  end if;
  select count(*) filter (where status = 'pending')::integer,
         coalesce(sum(requested_amount) filter (where status = 'pending'), 0),
         count(*) filter (where status = 'paid')::integer,
         coalesce(sum(requested_amount) filter (where status = 'paid'), 0)
    into pending_count, pending_amount, paid_count, paid_amount
    from public.affiliate_payout_requests;

  select coalesce(jsonb_agg(to_jsonb(request_rows) order by request_rows.created_at desc), '[]'::jsonb)
    into request_list
    from (
      select r.id, r.affiliate_id, r.affiliate_name, r.affiliate_email,
             r.payout_method_id, r.country_code, r.requested_amount, r.currency, r.status,
             r.available_balance_snapshot, r.method_type, r.method_currency, r.network,
             r.wallet_address_ciphertext, r.wallet_address_last4, r.memo_tag_ciphertext,
             r.destination_preview, r.destination_last4,
             r.request_note, r.admin_notes, r.user_message, r.reviewer_id, r.reviewed_at,
             r.paid_by, r.paid_at, r.payment_reference, r.created_at, r.updated_at
        from public.affiliate_payout_requests r
       where (normalized_status = '' or r.status = normalized_status)
         and (normalized_search = ''
              or lower(coalesce(r.affiliate_name, '')) like '%' || normalized_search || '%'
              or lower(coalesce(r.affiliate_email, '')) like '%' || normalized_search || '%'
              or lower(r.affiliate_id::text) like '%' || normalized_search || '%')
    ) request_rows;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'pendingCount', pending_count,
      'pendingAmount', pending_amount,
      'paidCount', paid_count,
      'paidAmount', paid_amount
    ),
    'requests', request_list
  );
end;
$$;

revoke all on public.affiliate_payout_country_methods from anon, authenticated;
revoke all on public.affiliate_payout_method_options from anon, authenticated;
revoke all on public.affiliate_payout_methods from anon, authenticated;
revoke all on public.affiliate_payout_requests from anon, authenticated;
revoke all on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_affiliate_payout_request(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.list_affiliate_payout_requests_admin(text, text) from public, anon, authenticated;
grant execute on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_affiliate_payout_request(uuid, numeric, text) to service_role;
grant execute on function public.list_affiliate_payout_requests_admin(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
