-- Le profil cognitif distingue désormais les emails rédigés par le contact des
-- réunions dont des prises de parole ont pu lui être attribuées sans ambiguïté.

alter table public.cognitive_profiles
  add column if not exists source_meeting_count integer not null default 0;

alter table public.cognitive_profiles
  drop constraint if exists cognitive_profiles_source_meeting_count_check;

alter table public.cognitive_profiles
  add constraint cognitive_profiles_source_meeting_count_check
  check (source_meeting_count >= 0);

notify pgrst, 'reload schema';
