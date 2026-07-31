-- Aligne « Mon profil » sur le même contrat comportemental V3 que les
-- fiches Personne : 6 axes primaires, 4 secondaires et cadran interpersonnel.

alter table public.user_behavioral_profiles
  add column if not exists cognitive_profile_data jsonb not null default '{}'::jsonb,
  add column if not exists source_interaction_count integer not null default 0,
  add column if not exists maturity_level text not null default 'none',
  add column if not exists analysis_version integer not null default 3,
  add column if not exists last_analyzed_at timestamptz;

alter table public.user_behavioral_profiles
  drop constraint if exists user_behavioral_profiles_maturity_level_check;

alter table public.user_behavioral_profiles
  add constraint user_behavioral_profiles_maturity_level_check
  check (maturity_level in ('none', 'emerging', 'usable', 'consolidated', 'refined'));

notify pgrst, 'reload schema';
