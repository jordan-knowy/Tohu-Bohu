alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

comment on column public.profiles.onboarding_completed is
  'Indique si le parcours initial Tohu a ete finalise.';

notify pgrst, 'reload schema';
