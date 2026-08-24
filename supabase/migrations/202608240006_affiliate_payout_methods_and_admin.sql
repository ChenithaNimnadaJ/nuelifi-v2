begin;

alter table public.affiliate_payout_method_options
  drop constraint if exists affiliate_payout_method_options_type_check;
alter table public.affiliate_payout_method_options
  add constraint affiliate_payout_method_options_type_check
  check (method_type in ('crypto_transfer', 'paypal', 'other'));

insert into public.affiliate_payout_method_options (method_type, currency, network, display_name, memo_required)
values
  ('paypal', 'USD', '', 'PayPal', false),
  ('other', 'USD', '', 'Other', false)
on conflict (method_type, currency, network) do nothing;

create table if not exists public.affiliate_payout_country_methods (
  country_code text not null,
  method_type text not null,
  currency text not null,
  network text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (country_code, method_type, currency, network),
  constraint affiliate_payout_country_methods_country_check check (country_code = upper(country_code) and (country_code = 'GLOBAL' or country_code ~ '^[A-Z]{2}$')),
  constraint affiliate_payout_country_methods_option_fk foreign key (method_type, currency, network)
    references public.affiliate_payout_method_options(method_type, currency, network)
    on update cascade on delete restrict
);

insert into public.affiliate_payout_country_methods (country_code, method_type, currency, network)
values
  ('GLOBAL', 'crypto_transfer', 'USDT', 'TRC20'),
  ('GLOBAL', 'other', 'USD', '')
on conflict (country_code, method_type, currency, network) do nothing;

create index if not exists affiliate_payout_country_methods_active_idx
  on public.affiliate_payout_country_methods (country_code, active, method_type, currency, network);

drop trigger if exists affiliate_payout_country_methods_updated_at on public.affiliate_payout_country_methods;
create trigger affiliate_payout_country_methods_updated_at
before update on public.affiliate_payout_country_methods
for each row execute function public.affiliate_payout_updated_at();

alter table public.affiliate_payout_methods
  add column if not exists country_code text not null default 'XX',
  add column if not exists paypal_email_ciphertext text,
  add column if not exists other_details_ciphertext text,
  add column if not exists destination_preview text not null default '',
  add column if not exists destination_last4 text;
alter table public.affiliate_payout_methods alter column wallet_address_ciphertext drop not null;
alter table public.affiliate_payout_methods alter column wallet_address_last4 drop not null;
alter table public.affiliate_payout_methods alter column network set default '';
alter table public.affiliate_payout_methods drop constraint if exists affiliate_payout_methods_last4_check;
alter table public.affiliate_payout_methods drop constraint if exists affiliate_payout_methods_type_check;
alter table public.affiliate_payout_methods drop constraint if exists affiliate_payout_methods_country_check;
alter table public.affiliate_payout_methods
  add constraint affiliate_payout_methods_last4_check check (wallet_address_last4 is null or wallet_address_last4 ~ '^[A-Za-z0-9]{4}$'),
  add constraint affiliate_payout_methods_type_check check (method_type in ('crypto_transfer', 'paypal', 'other')),
  add constraint affiliate_payout_methods_country_check check (country_code = upper(country_code) and country_code ~ '^[A-Z]{2}$');

alter table public.affiliate_payout_requests
  add column if not exists country_code text not null default 'XX',
  add column if not exists affiliate_name text not null default '',
  add column if not exists affiliate_email text,
  add column if not exists paypal_email_ciphertext text,
  add column if not exists other_details_ciphertext text,
  add column if not exists destination_preview text not null default '',
  add column if not exists destination_last4 text;
alter table public.affiliate_payout_requests alter column wallet_address_ciphertext drop not null;
alter table public.affiliate_payout_requests alter column wallet_address_last4 drop not null;
alter table public.affiliate_payout_requests alter column network set default '';
alter table public.affiliate_payout_requests drop constraint if exists affiliate_payout_requests_last4_check;
alter table public.affiliate_payout_requests drop constraint if exists affiliate_payout_requests_method_type_check;
alter table public.affiliate_payout_requests drop constraint if exists affiliate_payout_requests_country_check;
alter table public.affiliate_payout_requests
  add constraint affiliate_payout_requests_last4_check check (wallet_address_last4 is null or wallet_address_last4 ~ '^[A-Za-z0-9]{4}$'),
  add constraint affiliate_payout_requests_method_type_check check (method_type in ('crypto_transfer', 'paypal', 'other')),
  add constraint affiliate_payout_requests_country_check check (country_code = upper(country_code) and country_code ~ '^[A-Z]{2}$');

alter table public.affiliate_payout_country_methods enable row level security;
revoke all on public.affiliate_payout_country_methods from anon, authenticated;

revoke all on public.affiliate_payout_method_options from anon, authenticated;
revoke all on public.affiliate_payout_methods from anon, authenticated;
revoke all on public.affiliate_payout_requests from anon, authenticated;

drop function if exists public.save_affiliate_payout_method(uuid, text, text, text, text, text, text);
create or replace function public.save_affiliate_payout_method(
  p_affiliate_id uuid,
  p_country_code text,
  p_method_type text,
  p_currency text,
  p_network text,
  p_wallet_address_ciphertext text default null,
  p_destination_last4 text default null,
  p_paypal_email_ciphertext text default null,
  p_other_details_ciphertext text default null,
  p_destination_preview text default '',
  p_memo_tag_ciphertext text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_method public.affiliate_payout_methods%rowtype;
  option_row public.affiliate_payout_method_options%rowtype;
  normalized_country text := upper(trim(coalesce(p_country_code, '')));
  normalized_type text := lower(trim(coalesce(p_method_type, '')));
  normalized_currency text := upper(trim(coalesce(p_currency, '')));
  normalized_network text := upper(trim(coalesce(p_network, '')));
  normalized_preview text := left(trim(coalesce(p_destination_preview, '')), 320);
  normalized_last4 text := upper(nullif(trim(coalesce(p_destination_last4, '')), ''));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> p_affiliate_id) then
    raise exception 'Not allowed';
  end if;
  if normalized_country !~ '^[A-Z]{2}$' then raise exception 'Enter a valid two-letter country code'; end if;
  select * into option_row
    from public.affiliate_payout_method_options
   where method_type = normalized_type and currency = normalized_currency and network = normalized_network and active
   limit 1;
  if option_row.method_type is null then raise exception 'Unsupported payout method'; end if;
  if not exists (
    select 1 from public.affiliate_payout_country_methods cm
     where cm.active
       and (cm.country_code = normalized_country or cm.country_code = 'GLOBAL')
       and cm.method_type = normalized_type
       and cm.currency = normalized_currency
       and cm.network = normalized_network
  ) then
    raise exception 'That payout method is not configured for this country';
  end if;
  if normalized_type = 'crypto_transfer' then
    if p_wallet_address_ciphertext is null or length(p_wallet_address_ciphertext) < 20 or length(p_wallet_address_ciphertext) > 5000 then
      raise exception 'Payout method data is invalid';
    end if;
    if normalized_last4 is null or normalized_last4 !~ '^[A-Z0-9]{4}$' then raise exception 'Payout method data is invalid'; end if;
  elsif normalized_type = 'paypal' then
    if p_paypal_email_ciphertext is null or length(p_paypal_email_ciphertext) < 20 or length(p_paypal_email_ciphertext) > 5000 then raise exception 'Payout method data is invalid'; end if;
    if normalized_preview = '' then raise exception 'Payout method data is invalid'; end if;
  elsif normalized_type = 'other' then
    if p_other_details_ciphertext is null or length(p_other_details_ciphertext) < 20 or length(p_other_details_ciphertext) > 5000 then raise exception 'Payout method data is invalid'; end if;
    if normalized_preview = '' then normalized_preview := 'Manual review details saved'; end if;
  else
    raise exception 'Unsupported payout method';
  end if;
  if option_row.memo_required and p_memo_tag_ciphertext is null then raise exception 'A memo or tag is required for this payout method'; end if;

  update public.affiliate_payout_methods
     set is_active = false
   where affiliate_id = p_affiliate_id and is_active;
  insert into public.affiliate_payout_methods (
    affiliate_id, country_code, method_type, currency, network,
    wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext,
    paypal_email_ciphertext, other_details_ciphertext, destination_preview, destination_last4
  ) values (
    p_affiliate_id, normalized_country, normalized_type, normalized_currency, normalized_network,
    case when normalized_type = 'crypto_transfer' then p_wallet_address_ciphertext else null end,
    case when normalized_type = 'crypto_transfer' then normalized_last4 else null end,
    p_memo_tag_ciphertext,
    case when normalized_type = 'paypal' then p_paypal_email_ciphertext else null end,
    case when normalized_type = 'other' then p_other_details_ciphertext else null end,
    normalized_preview,
    normalized_last4
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
  if affiliate_email is null and affiliate_name is null then raise exception 'Affiliate account was not found'; end if;
  perform 1 from auth.users where id = p_affiliate_id for update;
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
    affiliate_id, affiliate_name, affiliate_email, payout_method_id, country_code,
    requested_amount, currency, available_balance_snapshot,
    method_type, method_currency, network,
    wallet_address_ciphertext, wallet_address_last4, memo_tag_ciphertext,
    paypal_email_ciphertext, other_details_ciphertext, destination_preview, destination_last4,
    request_note
  ) values (
    p_affiliate_id, left(coalesce(affiliate_name, ''), 120), left(affiliate_email, 320), method_row.id, method_row.country_code,
    round(p_requested_amount, 6), 'USD', eligible_balance,
    method_row.method_type, method_row.currency, method_row.network,
    method_row.wallet_address_ciphertext, method_row.wallet_address_last4, method_row.memo_tag_ciphertext,
    method_row.paypal_email_ciphertext, method_row.other_details_ciphertext, method_row.destination_preview, method_row.destination_last4,
    left(coalesce(p_request_note, ''), 500)
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
    'methodType', request_row.method_type,
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
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if normalized_status <> '' and normalized_status not in ('pending', 'approved', 'paid', 'rejected', 'cancelled') then raise exception 'Invalid payout status'; end if;
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
             r.paypal_email_ciphertext, r.other_details_ciphertext, r.destination_preview, r.destination_last4,
             r.request_note, r.admin_notes, r.user_message, r.reviewer_id, r.reviewed_at,
             r.paid_by, r.paid_at, r.payment_reference, r.created_at, r.updated_at
        from public.affiliate_payout_requests r
       where (normalized_status = '' or r.status = normalized_status)
         and (normalized_search = '' or lower(coalesce(r.affiliate_name, '')) like '%' || normalized_search || '%'
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

revoke all on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_affiliate_payout_request(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.list_affiliate_payout_requests_admin(text, text) from public, anon, authenticated;
grant execute on function public.save_affiliate_payout_method(uuid, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_affiliate_payout_request(uuid, numeric, text) to service_role;
grant execute on function public.list_affiliate_payout_requests_admin(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
