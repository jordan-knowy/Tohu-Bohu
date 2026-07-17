-- Fiche Personne Tohu — persistances P0, provenance et RLS.
-- Miroir du patron Compte (202607160012) : toutes les tables sont limitées
-- au workspace par private.is_org_member(), le score reste en écriture
-- service role, chaque information porte sa provenance.

create table if not exists public.person_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  relationship_type text,
  decision_role text,
  relationship_role text,
  primary_owner_user_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'restricted')),
  archived_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_id)
);

create table if not exists public.person_user_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite boolean not null default false,
  watch_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, contact_id, user_id)
);

create table if not exists public.person_relationship_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  score numeric check (score between 0 and 100),
  phase text check (phase in ('growing', 'stable', 'declining', 'unknown')),
  phase_delta numeric,
  intensity_score numeric check (intensity_score between 0 and 100),
  reciprocity_score numeric check (reciprocity_score between 0 and 100),
  recency_score numeric check (recency_score between 0 and 100),
  confidence numeric check (confidence between 0 and 100),
  total_interactions integer not null default 0 check (total_interactions >= 0),
  email_interactions integer,
  meeting_interactions integer,
  last_interaction_at timestamptz,
  computed_at timestamptz not null default now(),
  model_version text,
  source_type text not null default 'computed',
  source_id text,
  source_label text,
  source_url text,
  observed_at timestamptz,
  imported_at timestamptz,
  last_verified_at timestamptz,
  inference_level text not null default 'inferred',
  created_at timestamptz not null default now()
);

create table if not exists public.person_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  content text not null,
  confidence numeric check (confidence between 0 and 100),
  model text,
  generated_at timestamptz not null default now(),
  source_type text not null default 'computed',
  source_id text,
  source_label text not null default 'Synthèse Tohu',
  source_url text,
  observed_at timestamptz,
  imported_at timestamptz,
  last_verified_at timestamptz,
  inference_level text not null default 'inferred',
  created_at timestamptz not null default now()
);

create table if not exists public.person_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source_signal_id uuid references public.behavioral_signals(id) on delete set null,
  kind text not null default 'action' check (kind in ('coaching', 'action')),
  category text not null,
  action_type text,
  priority integer not null default 0,
  title text not null,
  justification text not null,
  recommended_action text,
  trigger_signal text,
  payload jsonb not null default '{}'::jsonb,
  source_type text not null default 'engine',
  source_id text,
  source_label text not null,
  source_url text,
  observed_at timestamptz not null,
  imported_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric check (confidence between 0 and 100),
  inference_level text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'dismissed', 'postponed')),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismiss_reason text,
  feedback_type text check (feedback_type in ('useful', 'incorrect')),
  feedback_reason text,
  feedback_by uuid references auth.users(id) on delete set null,
  feedback_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_contact_details (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  detail_type text not null check (detail_type in ('email', 'phone', 'linkedin', 'website', 'other')),
  value text not null,
  label text,
  is_primary boolean not null default false,
  verification_status text not null default 'unverified' check (verification_status in ('verified', 'unverified', 'invalid')),
  visibility text not null default 'workspace' check (visibility in ('workspace', 'private')),
  archived_at timestamptz,
  source_type text not null default 'manual',
  source_id text,
  source_label text not null default 'Saisie manuelle',
  source_url text,
  observed_at timestamptz,
  imported_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_contact_detail_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  detail_id uuid not null references public.person_contact_details(id) on delete cascade,
  previous_value text not null,
  new_value text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.person_career_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  entry_type text not null default 'experience' check (entry_type in ('experience', 'education', 'detected_change')),
  title text not null,
  organization_name text not null,
  location text,
  started_at date,
  ended_at date,
  is_current boolean not null default false,
  description text,
  verification_status text not null default 'to_confirm' check (verification_status in ('confirmed', 'probable', 'to_confirm', 'rejected')),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  source_type text not null default 'manual',
  source_id text,
  source_label text not null default 'Saisie manuelle',
  source_url text,
  observed_at timestamptz,
  imported_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_memory_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('note', 'file', 'voice', 'report', 'info', 'decision', 'commitment', 'preference', 'risk')),
  content text not null,
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  transcription text,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'private')),
  processing_status text not null default 'ready',
  source_type text not null default 'manual',
  source_label text not null default 'Note d''équipe',
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'manual',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists person_score_contact_date_idx on public.person_relationship_score_snapshots(contact_id, computed_at desc);
create index if not exists person_recommendations_open_idx on public.person_recommendations(contact_id, priority desc) where status = 'open';
create index if not exists person_contact_details_contact_idx on public.person_contact_details(contact_id) where archived_at is null;
create index if not exists person_career_contact_idx on public.person_career_entries(contact_id, started_at desc);
create index if not exists person_memory_contact_date_idx on public.person_memory_entries(contact_id, created_at desc);
create index if not exists person_summaries_contact_date_idx on public.person_summaries(contact_id, generated_at desc);

-- Cohérence workspace : le contact (et le compte éventuel) doivent appartenir
-- à l'organisation de la ligne.
create or replace function public.validate_person_detail_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then raise exception 'La personne n''appartient pas au workspace actif'; end if;
  v_company_id := nullif(to_jsonb(new) ->> 'company_id', '')::uuid;
  if v_company_id is not null and not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.organization_id = new.organization_id
  ) then raise exception 'Le compte n''appartient pas au workspace actif'; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'person_settings','person_user_settings','person_relationship_score_snapshots',
    'person_summaries','person_recommendations','person_contact_details',
    'person_contact_detail_revisions','person_career_entries','person_memory_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_validate_scope', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_person_detail_scope()', t || '_validate_scope', t);
  end loop;
end $$;

-- Lecture : membres du workspace (sauf exceptions ci-dessous).
do $$
declare t text;
begin
  foreach t in array array[
    'person_settings','person_relationship_score_snapshots','person_summaries',
    'person_recommendations','person_career_entries','person_contact_detail_revisions'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', t || '_member_select', t);
  end loop;
end $$;

-- Favori / veille : visibles et modifiables uniquement par leur utilisateur.
drop policy if exists person_user_settings_owner_all on public.person_user_settings;
create policy person_user_settings_owner_all on public.person_user_settings
for all to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

-- Réglages (rôles, owner) : écriture membre, auteur tracé.
drop policy if exists person_settings_member_write on public.person_settings;
create policy person_settings_member_write on public.person_settings
for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

-- Recommandations : statut/feedback modifiables par un membre, auteur tracé.
-- La création reste réservée au moteur backend (service role).
drop policy if exists person_recommendations_member_update on public.person_recommendations;
create policy person_recommendations_member_update on public.person_recommendations
for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

-- Coordonnées : lecture workspace sauf visibilité privée (créateur seul).
drop policy if exists person_contact_details_member_select on public.person_contact_details;
create policy person_contact_details_member_select on public.person_contact_details
for select to authenticated
using (private.is_org_member(organization_id) and (visibility = 'workspace' or created_by = (select auth.uid())));

drop policy if exists person_contact_details_member_insert on public.person_contact_details;
create policy person_contact_details_member_insert on public.person_contact_details
for insert to authenticated
with check (private.is_org_member(organization_id) and created_by = (select auth.uid()));

drop policy if exists person_contact_details_member_update on public.person_contact_details;
create policy person_contact_details_member_update on public.person_contact_details
for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

drop policy if exists person_contact_detail_revisions_author_insert on public.person_contact_detail_revisions;
create policy person_contact_detail_revisions_author_insert on public.person_contact_detail_revisions
for insert to authenticated
with check (private.is_org_member(organization_id) and changed_by = (select auth.uid()));

-- Parcours : validation/correction par un membre, auteur tracé.
drop policy if exists person_career_member_write on public.person_career_entries;
create policy person_career_member_write on public.person_career_entries
for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and (created_by = (select auth.uid()) or validated_by = (select auth.uid())));

-- Mémoire : lecture workspace sauf note privée (auteur seul) ; écriture auteur.
drop policy if exists person_memory_member_select on public.person_memory_entries;
create policy person_memory_member_select on public.person_memory_entries
for select to authenticated
using (private.is_org_member(organization_id) and (visibility = 'workspace' or author_user_id = (select auth.uid())));

drop policy if exists person_memory_author_insert on public.person_memory_entries;
create policy person_memory_author_insert on public.person_memory_entries
for insert to authenticated
with check (private.is_org_member(organization_id) and author_user_id = (select auth.uid()));

drop policy if exists person_memory_author_update on public.person_memory_entries;
create policy person_memory_author_update on public.person_memory_entries
for update to authenticated
using (author_user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (author_user_id = (select auth.uid()) and private.is_org_member(organization_id));

-- Score et synthèse : lecture seule côté client, écriture service role.
revoke all on public.person_relationship_score_snapshots from anon, authenticated;
revoke all on public.person_summaries from anon, authenticated;
grant select on public.person_relationship_score_snapshots, public.person_summaries to authenticated;
grant all on public.person_relationship_score_snapshots, public.person_summaries to service_role;

grant select, insert, update on public.person_settings, public.person_user_settings,
  public.person_recommendations, public.person_contact_details,
  public.person_career_entries, public.person_memory_entries to authenticated;
grant select, insert on public.person_contact_detail_revisions to authenticated;

-- Bucket privé pour la mémoire relationnelle (fichiers et notes vocales).
insert into storage.buckets (id, name, public)
values ('person-memory', 'person-memory', false)
on conflict (id) do nothing;

-- Chemin des objets : <organization_id>/<contact_id>/<fichier>.
drop policy if exists person_memory_objects_select on storage.objects;
create policy person_memory_objects_select on storage.objects
for select to authenticated
using (bucket_id = 'person-memory' and private.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists person_memory_objects_insert on storage.objects;
create policy person_memory_objects_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'person-memory' and private.is_org_member(((storage.foldername(name))[1])::uuid));

notify pgrst, 'reload schema';
