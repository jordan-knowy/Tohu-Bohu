alter table public.connectors drop constraint if exists connectors_provider_check;
alter table public.connectors add constraint connectors_provider_check
  check (provider = any (array['google','microsoft','linkedin','hubspot','salesforce','pipedrive','attio','zoom','teams','slack','read_ai','notion']::text[]));

create unique index if not exists meeting_transcripts_meeting_provider_idx
  on public.meeting_transcripts (meeting_id, provider) where meeting_id is not null;
