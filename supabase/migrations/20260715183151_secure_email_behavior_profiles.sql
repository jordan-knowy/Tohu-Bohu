create table if not exists public.user_behavioral_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  global_confidence integer not null default 0 check (global_confidence between 0 and 100),
  executive_summary text,
  cognitive_mode text,
  cognitive_mode_confidence numeric check (cognitive_mode_confidence between 0 and 100),
  behavioral_analysis_data jsonb not null default '[]'::jsonb,
  communication_style_data jsonb not null default '{}'::jsonb,
  source_message_count integer not null default 0,
  updated_from text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists user_behavioral_profiles_user_idx on public.user_behavioral_profiles(user_id);
alter table public.user_behavioral_profiles enable row level security;
drop policy if exists user_behavioral_profiles_select_self on public.user_behavioral_profiles;
create policy user_behavioral_profiles_select_self on public.user_behavioral_profiles for select to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id));
revoke all on public.user_behavioral_profiles from anon;
revoke insert, update, delete, truncate, references, trigger on public.user_behavioral_profiles from authenticated;
grant select on public.user_behavioral_profiles to authenticated;
grant all on public.user_behavioral_profiles to service_role;
create unique index if not exists oauth_accounts_connector_id_key on public.oauth_accounts(connector_id);
revoke all on public.oauth_accounts from anon, authenticated;
grant all on public.oauth_accounts to service_role;
comment on table public.user_behavioral_profiles is 'Profil comportemental du responsable connecte, produit cote serveur a partir de communications autorisees.';
comment on table public.oauth_accounts is 'Jetons OAuth chiffres. Acces reserve aux fonctions utilisant la service role.';
notify pgrst, 'reload schema';
