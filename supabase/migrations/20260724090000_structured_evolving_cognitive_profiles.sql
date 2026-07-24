-- Profil cognitif évolutif : le référentiel est fixe, les observations restent
-- propres à chaque personne et sont recalculées au fil des synchronisations.

alter table public.cognitive_profiles
  add column if not exists cognitive_profile_data jsonb not null default '{}'::jsonb,
  add column if not exists communication_style_data jsonb not null default '{}'::jsonb,
  add column if not exists source_message_count integer not null default 0,
  add column if not exists source_interaction_count integer not null default 0,
  add column if not exists maturity_level text not null default 'none',
  add column if not exists analysis_version integer not null default 2,
  add column if not exists last_analyzed_at timestamptz;

alter table public.cognitive_profiles
  drop constraint if exists cognitive_profiles_maturity_level_check;

alter table public.cognitive_profiles
  add constraint cognitive_profiles_maturity_level_check
  check (maturity_level in ('none', 'emerging', 'usable', 'consolidated', 'refined'));

create index if not exists cognitive_profiles_maturity_idx
  on public.cognitive_profiles (organization_id, maturity_level, last_analyzed_at desc);

notify pgrst, 'reload schema';
