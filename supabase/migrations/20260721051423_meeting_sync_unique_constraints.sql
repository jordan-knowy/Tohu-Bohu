-- Prépare l'ingestion Google Meet / Teams. `meeting_transcripts` avait été supprimée
-- le 2026-07-19 (table jamais alimentée à l'époque) — on la recrée, avec la même forme
-- que l'original, pour stocker le texte reconstitué des transcripts. On ajoute aussi les
-- contraintes d'unicité nécessaires : sans elles, un upsert répété créerait des doublons
-- de réunions/participants/transcripts à chaque synchronisation.

create table if not exists public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  provider text not null,
  transcript_text text not null,
  speaker_map jsonb not null default '{}',
  consent_status text not null default 'unknown' check (consent_status in ('unknown', 'granted', 'revoked')),
  created_at timestamptz not null default now()
);

alter table public.meeting_transcripts enable row level security;

drop policy if exists meeting_transcripts_member_select on public.meeting_transcripts;
create policy meeting_transcripts_member_select on public.meeting_transcripts
for select to authenticated
using (private.is_org_member(organization_id));

revoke all on public.meeting_transcripts from anon, authenticated;
grant select on public.meeting_transcripts to authenticated;
grant all on public.meeting_transcripts to service_role;

create unique index if not exists meetings_org_external_event_idx
  on public.meetings (organization_id, external_event_id)
  where external_event_id is not null;

create unique index if not exists meeting_participants_meeting_email_idx
  on public.meeting_participants (meeting_id, email)
  where email is not null;

create unique index if not exists meeting_transcripts_meeting_provider_idx
  on public.meeting_transcripts (meeting_id, provider);

notify pgrst, 'reload schema';
