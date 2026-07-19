alter table public.contacts add column if not exists last_monitored_at timestamptz;
create index if not exists idx_contacts_last_monitored on public.contacts(last_monitored_at);
