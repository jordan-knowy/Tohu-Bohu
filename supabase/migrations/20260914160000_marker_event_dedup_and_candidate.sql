alter table scoring.marker_event
  add column if not exists dedup_key text,
  add column if not exists is_candidate boolean not null default false;
create unique index if not exists marker_event_dedup
  on scoring.marker_event(organization_id, dedup_key) where dedup_key is not null;
create index if not exists marker_event_scoreable
  on scoring.marker_event(account_id, contact_id, observed_at) where is_candidate = false and deprecated_at is null;
notify pgrst, 'reload schema';
