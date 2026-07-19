alter table public.contacts  add column if not exists enrichment_data jsonb;
alter table public.companies add column if not exists enrichment_data jsonb;
alter table public.companies add column if not exists enriched_at timestamptz;
