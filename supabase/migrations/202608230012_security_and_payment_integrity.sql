-- Security and payment-integrity hardening after the full production audit.
-- New Paddle entitlements are annual-only and must be resolved by the Worker from verified price IDs.

create or replace function public.stage_paddle_pending_purchase(
  p_paddle_customer_id text,
  p_paddle_subscription_id text,
  p_paddle_transaction_id text,
  p_email text,
  p_plan text,
  p_billing_interval text,
  p_price_id text,
  p_provider_status text,
  p_provider_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_event_at timestamptz := coalesce(p_event_at, now());
  normalized_subscription_id text := nullif(btrim(p_paddle_subscription_id), '');
  updated_existing boolean := false;
  updated_rows integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_plan not in ('pro', 'premium') or p_billing_interval <> 'year' then
    raise exception 'Unsupported pending Paddle purchase';
  end if;
  if normalized_subscription_id is null then
    raise exception 'Pending Paddle purchase requires a subscription ID';
  end if;

  update public.paddle_pending_purchases
     set paddle_customer_id = coalesce(nullif(btrim(p_paddle_customer_id), ''), paddle_customer_id),
         paddle_transaction_id = coalesce(nullif(btrim(p_paddle_transaction_id), ''), paddle_transaction_id),
         email = coalesce(nullif(btrim(p_email), ''), email),
         plan = p_plan,
         billing_interval = 'year',
         price_id = coalesce(nullif(btrim(p_price_id), ''), price_id),
         provider_status = coalesce(nullif(btrim(p_provider_status), ''), provider_status),
         status = 'pending',
         provider_data = coalesce(p_provider_data, provider_data),
         event_at = normalized_event_at,
         updated_at = now()
   where paddle_subscription_id = normalized_subscription_id
     and event_at <= normalized_event_at;

  get diagnostics updated_rows = row_count;
  updated_existing := updated_rows > 0;
  if updated_existing then
    return;
  end if;

  begin
    insert into public.paddle_pending_purchases (
      paddle_customer_id, paddle_subscription_id, paddle_transaction_id,
      email, plan, billing_interval, price_id, provider_status,
      provider_data, event_at
    ) values (
      nullif(btrim(p_paddle_customer_id), ''),
      normalized_subscription_id,
      nullif(btrim(p_paddle_transaction_id), ''),
      nullif(btrim(p_email), ''),
      p_plan,
      'year',
      nullif(btrim(p_price_id), ''),
      nullif(btrim(p_provider_status), ''),
      coalesce(p_provider_data, '{}'::jsonb),
      normalized_event_at
    );
  exception when unique_violation then
    update public.paddle_pending_purchases
       set paddle_customer_id = coalesce(nullif(btrim(p_paddle_customer_id), ''), paddle_customer_id),
           paddle_transaction_id = coalesce(nullif(btrim(p_paddle_transaction_id), ''), paddle_transaction_id),
           email = coalesce(nullif(btrim(p_email), ''), email),
           plan = p_plan,
           billing_interval = 'year',
           price_id = coalesce(nullif(btrim(p_price_id), ''), price_id),
           provider_status = coalesce(nullif(btrim(p_provider_status), ''), provider_status),
           provider_data = coalesce(p_provider_data, provider_data),
           event_at = normalized_event_at,
           updated_at = now()
     where paddle_subscription_id = normalized_subscription_id
       and event_at <= normalized_event_at;
  end;
end;
$$;

create or replace function public.sync_paddle_customer(
  p_user_id uuid,
  p_paddle_customer_id text,
  p_email text,
  p_name text,
  p_locale text,
  p_status text,
  p_marketing_consent boolean,
  p_custom_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if nullif(btrim(p_paddle_customer_id), '') is null then
    raise exception 'Paddle customer ID is required';
  end if;
  if p_user_id is not null and not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Paddle customer user does not exist';
  end if;

  insert into public.paddle_customers (
    user_id, paddle_customer_id, email, name, locale, status,
    marketing_consent, custom_data, first_seen_at, last_event_at
  ) values (
    p_user_id, nullif(btrim(p_paddle_customer_id), ''),
    nullif(left(btrim(coalesce(p_email, '')), 320), ''),
    nullif(left(btrim(coalesce(p_name, '')), 300), ''),
    nullif(left(btrim(coalesce(p_locale, '')), 32), ''),
    nullif(left(btrim(coalesce(p_status, '')), 32), ''),
    p_marketing_consent, coalesce(p_custom_data, '{}'::jsonb),
    coalesce(p_event_at, now()), coalesce(p_event_at, now())
  )
  on conflict (paddle_customer_id) do update set
    user_id = coalesce(excluded.user_id, paddle_customers.user_id),
    email = coalesce(excluded.email, paddle_customers.email),
    name = coalesce(excluded.name, paddle_customers.name),
    locale = coalesce(excluded.locale, paddle_customers.locale),
    status = coalesce(excluded.status, paddle_customers.status),
    marketing_consent = coalesce(excluded.marketing_consent, paddle_customers.marketing_consent),
    custom_data = case when excluded.custom_data = '{}'::jsonb then paddle_customers.custom_data else excluded.custom_data end,
    last_event_at = excluded.last_event_at
  where paddle_customers.last_event_at is null or paddle_customers.last_event_at <= excluded.last_event_at;

  if nullif(btrim(p_email), '') is not null then
    update public.paddle_pending_purchases
       set email = left(btrim(p_email), 320), updated_at = now()
     where paddle_customer_id = nullif(btrim(p_paddle_customer_id), '')
       and status = 'pending'
       and (email is null or btrim(email) = '');
  end if;
end;
$$;

create or replace function public.sync_paddle_subscription(
  p_user_id uuid,
  p_plan text,
  p_status text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_billing_interval text,
  p_price_id text,
  p_provider_status text,
  p_current_billing_period jsonb,
  p_scheduled_change jsonb,
  p_provider_data jsonb,
  p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_interval text;
  existing_subscription_id text;
  is_existing_legacy boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Subscription user does not exist';
  end if;
  if p_plan not in ('pro', 'premium') then
    raise exception 'Unsupported Paddle plan';
  end if;
  if p_status not in ('active', 'past_due', 'cancelled') then
    raise exception 'Unsupported subscription status';
  end if;

  select billing_interval, provider_subscription_id
    into existing_interval, existing_subscription_id
    from public.subscriptions
   where user_id = p_user_id;

  is_existing_legacy := p_billing_interval = 'month'
    and existing_interval = 'month'
    and existing_subscription_id = p_provider_subscription_id;

  if p_billing_interval <> 'year' and not is_existing_legacy then
    return;
  end if;
  if p_billing_interval = 'year' and nullif(btrim(p_price_id), '') is null and p_status = 'active' and existing_subscription_id is distinct from p_provider_subscription_id then
    raise exception 'Active Paddle subscription requires a verified price ID';
  end if;

  insert into public.subscriptions (
    user_id, plan, status, provider, provider_customer_id, provider_subscription_id,
    billing_interval, price_id, provider_status, current_billing_period,
    scheduled_change, provider_data, last_provider_event_at
  ) values (
    p_user_id, p_plan, p_status, 'paddle',
    nullif(btrim(p_provider_customer_id), ''),
    nullif(btrim(p_provider_subscription_id), ''),
    p_billing_interval, nullif(btrim(p_price_id), ''),
    nullif(btrim(p_provider_status), ''), p_current_billing_period,
    p_scheduled_change, coalesce(p_provider_data, '{}'::jsonb), coalesce(p_event_at, now())
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    provider = excluded.provider,
    provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
    billing_interval = coalesce(excluded.billing_interval, subscriptions.billing_interval),
    price_id = coalesce(excluded.price_id, subscriptions.price_id),
    provider_status = excluded.provider_status,
    current_billing_period = excluded.current_billing_period,
    scheduled_change = excluded.scheduled_change,
    provider_data = excluded.provider_data,
    last_provider_event_at = excluded.last_provider_event_at
  where subscriptions.last_provider_event_at is null or subscriptions.last_provider_event_at <= excluded.last_provider_event_at;
end;
$$;

create or replace function public.record_referral_scan(p_referred_user_id uuid, p_event_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referral_row public.referrals%rowtype;
  event_id uuid;
  reward_amount numeric(12, 6);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_referred_user_id is null or p_event_key is null or p_event_key !~ '^scan:[0-9a-f-]{36}$' then
    raise exception 'Invalid referral scan event';
  end if;
  select * into referral_row from public.referrals where referred_user_id = p_referred_user_id limit 1;
  if referral_row.id is null then return; end if;
  select setting_value into reward_amount from public.referral_settings where setting_key = 'meal_scan_reward';
  insert into public.referral_events (referral_id, event_type, event_key, amount)
  values (referral_row.id, 'meal_scan', p_event_key, coalesce(reward_amount, 0.001))
  on conflict (event_key) do nothing
  returning id into event_id;
  if event_id is not null then
    insert into public.referral_rewards (event_id, referral_id, referrer_user_id, referred_user_id, reward_type, amount, metadata)
    values (event_id, referral_row.id, referral_row.referrer_user_id, referral_row.referred_user_id, 'meal_scan', coalesce(reward_amount, 0.001), jsonb_build_object('event_key', p_event_key));
  end if;
end;
$$;

create or replace function public.persist_meal_analysis(
  p_user_id uuid,
  p_event_key text,
  p_image_url text,
  p_meal_name text,
  p_captured_at timestamptz,
  p_provider text,
  p_analysis jsonb,
  p_image_urls jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_meal_id uuid;
  saved_meal_id uuid;
  supplied_images jsonb := coalesce(p_image_urls, '[]'::jsonb);
  normalized_images jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_user_id is null or p_event_key is null or p_event_key !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'Meal event is incomplete';
  end if;
  if p_provider not in ('gemini', 'groq-fallback') then
    raise exception 'Meal analysis provider is not verified';
  end if;
  if nullif(btrim(p_image_url), '') is null then
    raise exception 'Meal image is required';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' or pg_column_size(p_analysis) > 200000 then
    raise exception 'Meal analysis is invalid or too large';
  end if;
  if nullif(btrim(p_analysis->>'rating'), '') is null
     or (p_analysis->>'score') !~ '^-?[0-9]+([.][0-9]+)?$'
     or jsonb_typeof(coalesce(p_analysis->'mealGuidance', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_analysis->'dailyTasks', '[]'::jsonb)) <> 'array' then
    raise exception 'Meal analysis is incomplete';
  end if;
  if jsonb_typeof(supplied_images) <> 'array' or jsonb_array_length(supplied_images) > 1 then
    raise exception 'Only one meal photo is allowed per scan';
  end if;

  select meal_id into existing_meal_id
    from public.meal_ingest_events
   where event_key = p_event_key and user_id = p_user_id
   limit 1;
  if existing_meal_id is not null then return existing_meal_id; end if;
  if exists (select 1 from public.meal_ingest_events where event_key = p_event_key) then
    raise exception 'Meal event key is already used';
  end if;

  normalized_images := jsonb_build_array(btrim(p_image_url));
  insert into public.meals (user_id, image_url, image_urls, meal_name, status, captured_at)
  values (p_user_id, normalized_images->>0, normalized_images, left(coalesce(nullif(btrim(p_meal_name), ''), 'Meal'), 120), 'analysed', coalesce(p_captured_at, now()))
  returning id into saved_meal_id;

  insert into public.meal_analyses (meal_id, rating, score, indicators, explanation, recommendations, meal_guidance, daily_tasks)
  values (
    saved_meal_id,
    left(coalesce(p_analysis->>'rating', 'Reasonable'), 40),
    greatest(0, least(100, coalesce((p_analysis->>'score')::integer, 60))),
    case when jsonb_typeof(p_analysis->'indicators') = 'object' then p_analysis->'indicators' else '{}'::jsonb end,
    left(coalesce(p_analysis->>'explanation', ''), 4000),
    case when jsonb_typeof(p_analysis->'mealGuidance') = 'array' then p_analysis->'mealGuidance' else '[]'::jsonb end,
    case when jsonb_typeof(p_analysis->'mealGuidance') = 'array' then p_analysis->'mealGuidance' else '[]'::jsonb end,
    case when jsonb_typeof(p_analysis->'dailyTasks') = 'array' then p_analysis->'dailyTasks' else '[]'::jsonb end
  );

  insert into public.meal_ingest_events (event_key, user_id, meal_id)
  values (p_event_key, p_user_id, saved_meal_id);
  perform public.record_activity_internal(p_user_id, 'meal_scan', saved_meal_id::text);
  perform public.record_referral_scan(p_user_id, 'scan:' || saved_meal_id::text);
  return saved_meal_id;
end;
$$;

-- Internal payment and persistence functions are called by the Worker with service role only.
revoke all on function public.stage_paddle_pending_purchase(text, text, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.stage_paddle_pending_purchase(text, text, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
revoke all on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_paddle_customer(uuid, text, text, text, text, text, boolean, jsonb, timestamptz) to service_role;
revoke all on function public.sync_paddle_subscription(uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_paddle_subscription(uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;
revoke all on function public.claim_paddle_pending_purchases(uuid) from public, anon, authenticated;
grant execute on function public.claim_paddle_pending_purchases(uuid) to service_role;
revoke all on function public.mark_paddle_pending_purchase_inactive(text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_paddle_pending_purchase_inactive(text, text, jsonb, timestamptz) to service_role;
revoke all on function public.record_referral_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.record_referral_scan(uuid, text) to service_role;
revoke all on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_meal_analysis(uuid, text, text, text, timestamptz, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
