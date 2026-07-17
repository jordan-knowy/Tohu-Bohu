-- Fiche Compte Tohu — données persistées P0, provenance et RLS.
-- Toutes les tables sont limitées au workspace par private.is_org_member().

create table if not exists public.account_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  relationship_status text,
  offer_scope text,
  relationship_started_at date,
  strategic boolean not null default false,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'restricted')),
  primary_owner_user_id uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_id)
);

create table if not exists public.account_user_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, company_id, user_id)
);

create table if not exists public.account_watch_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  families text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, company_id)
);

create table if not exists public.account_relationship_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  score numeric check (score between 0 and 100),
  phase text check (phase in ('growing', 'stable', 'declining', 'unknown')),
  phase_delta numeric,
  confidence numeric check (confidence between 0 and 100),
  concentration_risk numeric check (concentration_risk between 0 and 100),
  contact_coverage numeric check (contact_coverage between 0 and 100),
  decision_maker_coverage numeric check (decision_maker_coverage between 0 and 100),
  total_interactions integer not null default 0 check (total_interactions >= 0),
  interaction_frequency_30d numeric,
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

create table if not exists public.account_contact_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  organizational_role text,
  decision_role text,
  relationship_role text,
  exchange_share numeric check (exchange_share between 0 and 100),
  internal_owner_user_id uuid references auth.users(id) on delete set null,
  source_type text not null default 'manual',
  source_id text,
  source_label text,
  source_url text,
  observed_at timestamptz,
  imported_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'manual',
  authored_by uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_id, contact_id)
);

create table if not exists public.account_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  source_signal_id uuid references public.company_signals(id) on delete set null,
  category text not null,
  priority integer not null default 0,
  title text not null,
  justification text not null,
  recommended_action text,
  impact_type text,
  source_label text not null,
  source_url text,
  observed_at timestamptz not null,
  confidence numeric check (confidence between 0 and 100),
  inference_level text,
  status text not null default 'open' check (status in ('open', 'completed', 'dismissed', 'postponed')),
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  feedback_type text,
  feedback_reason text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_memory_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('note', 'context', 'meeting_note', 'event', 'decision', 'risk', 'opportunity', 'handover')),
  content text not null,
  file_path text,
  transcription text,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'restricted')),
  processing_status text not null default 'ready',
  source_type text not null default 'manual',
  source_label text not null default 'Note d''équipe',
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'manual',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_firmographic_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  fact_key text not null,
  value jsonb not null,
  source_type text not null,
  source_id text,
  source_label text not null,
  source_url text,
  observed_at timestamptz not null,
  imported_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric check (confidence between 0 and 100),
  inference_level text not null default 'observed',
  validation_status text not null default 'unverified' check (validation_status in ('unverified', 'confirmed', 'rejected', 'conflicting')),
  validated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_score_company_date_idx on public.account_relationship_score_snapshots(company_id, computed_at desc);
create index if not exists account_roles_company_idx on public.account_contact_roles(company_id) where active;
create index if not exists account_recommendations_open_idx on public.account_recommendations(company_id, priority desc) where status = 'open';
create index if not exists account_memory_company_date_idx on public.account_memory_entries(company_id, created_at desc);
create index if not exists account_facts_company_key_idx on public.account_firmographic_facts(company_id, fact_key, observed_at desc);

create or replace function public.validate_account_detail_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
begin
  if not exists (
    select 1 from public.companies c
    where c.id = new.company_id and c.organization_id = new.organization_id
  ) then raise exception 'Le compte n''appartient pas au workspace actif'; end if;
  v_contact_id := nullif(to_jsonb(new) ->> 'contact_id', '')::uuid;
  if v_contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = v_contact_id and c.company_id = new.company_id and c.organization_id = new.organization_id
  ) then raise exception 'La personne n''appartient pas à ce compte'; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'account_settings','account_watch_settings',
    'account_relationship_score_snapshots','account_contact_roles',
    'account_recommendations','account_memory_entries','account_firmographic_facts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', t || '_member_select', t);
  end loop;
end $$;

drop policy if exists account_preferences_owner_select on public.account_user_preferences;
create policy account_preferences_owner_select on public.account_user_preferences
for select to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists account_preferences_owner_write on public.account_user_preferences;
create policy account_preferences_owner_write on public.account_user_preferences
for all to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists account_watch_member_write on public.account_watch_settings;
create policy account_watch_member_write on public.account_watch_settings
for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

drop policy if exists account_settings_member_write on public.account_settings;
create policy account_settings_member_write on public.account_settings
for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

drop policy if exists account_roles_member_write on public.account_contact_roles;
create policy account_roles_member_write on public.account_contact_roles
for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and authored_by = (select auth.uid()));

drop policy if exists account_recommendations_member_update on public.account_recommendations;
create policy account_recommendations_member_update on public.account_recommendations
for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id) and updated_by = (select auth.uid()));

drop policy if exists account_memory_author_insert on public.account_memory_entries;
create policy account_memory_author_insert on public.account_memory_entries
for insert to authenticated
with check (private.is_org_member(organization_id) and author_user_id = (select auth.uid()));

drop policy if exists account_memory_author_update on public.account_memory_entries;
create policy account_memory_author_update on public.account_memory_entries
for update to authenticated
using (author_user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (author_user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists account_facts_member_validate on public.account_firmographic_facts;
create policy account_facts_member_validate on public.account_firmographic_facts
for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array[
    'account_settings','account_user_preferences','account_watch_settings',
    'account_contact_roles','account_recommendations','account_memory_entries',
    'account_firmographic_facts'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_validate_scope', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_account_detail_scope()', t || '_validate_scope', t);
  end loop;
end $$;

revoke all on public.account_relationship_score_snapshots from anon, authenticated;
grant select on public.account_relationship_score_snapshots to authenticated;
grant all on public.account_relationship_score_snapshots to service_role;
grant select, insert, update on public.account_settings, public.account_user_preferences,
  public.account_watch_settings, public.account_contact_roles, public.account_recommendations,
  public.account_memory_entries, public.account_firmographic_facts to authenticated;

notify pgrst, 'reload schema';
