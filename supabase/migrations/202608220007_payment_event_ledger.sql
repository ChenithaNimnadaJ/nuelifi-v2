create table if not exists public.payment_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_events_status_idx on public.payment_events(status, received_at desc);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

notify pgrst, 'reload schema';
