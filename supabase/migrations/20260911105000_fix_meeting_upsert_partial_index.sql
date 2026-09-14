-- Bug pré-existant découvert en testant sync-google-calendar : les index d'unicité
-- de meeting_sync_unique_constraints.sql (20260721051423) sont PARTIELS
-- (`where external_event_id is not null` / `where email is not null`). Postgres
-- ne les fait correspondre à `ON CONFLICT (colonnes)` que si la clause ON CONFLICT
-- porte le même prédicat — ce que supabase-js `.upsert(data, { onConflict })` ne
-- sait pas exprimer. Résultat concret : « there is no unique or exclusion
-- constraint matching the ON CONFLICT specification » sur CHAQUE upsert de
-- meetings/meeting_participants, dans sync-google-meet et sync-teams-meetings
-- déjà en production, pas seulement dans le nouveau code calendrier.
--
-- external_event_id/email restent nullable : un index unique NON partiel traite
-- déjà nativement deux NULL comme non-dupliqués (sémantique SQL standard), donc
-- ce correctif ne change aucun comportement réel de déduplication, il rend
-- seulement l'upsert exploitable par PostgREST/supabase-js.

drop index if exists public.meetings_org_external_event_idx;
alter table public.meetings
  add constraint meetings_org_external_event_key unique (organization_id, external_event_id);

drop index if exists public.meeting_participants_meeting_email_idx;
alter table public.meeting_participants
  add constraint meeting_participants_meeting_email_key unique (meeting_id, email);

notify pgrst, 'reload schema';
