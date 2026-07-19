create extension if not exists "pgcrypto";
create extension if not exists "vector";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  role_title text,
  company_name text,
  website_url text,
  product_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_timing_minutes integer not null default 30,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  daily_digest_enabled boolean not null default true,
  daily_digest_time time not null default '08:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.privacy_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  analyze_email boolean not null default true,
  analyze_calendar boolean not null default true,
  analyze_transcripts boolean not null default false,
  share_with_team boolean not null default false,
  retention_days integer not null default 365,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'hubspot', 'salesforce', 'pipedrive', 'slack', 'zoom', 'teams', 'meet')),
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'expired', 'error', 'revoked')),
  scopes text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);

create table if not exists public.oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null references public.connectors(id) on delete cascade,
  provider_account_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid references public.connectors(id) on delete set null,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  error_message text,
  payload jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  domain text,
  industry text,
  size_label text,
  public_context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  email text,
  role_title text,
  linkedin_url text,
  avatar_url text,
  source_summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  external_event_id text,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  platform text,
  meeting_type text not null default 'commercial' check (meeting_type in ('commercial', 'partnership', 'productivity', 'internal', 'other')),
  importance_score integer not null default 0 check (importance_score between 0 and 100),
  brief_status text not null default 'to_generate' check (brief_status in ('to_generate', 'queued', 'generating', 'ready', 'failed', 'insufficient_data', 'consulted')),
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email text,
  display_name text,
  role_in_meeting text,
  is_current_user boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  external_thread_id text,
  subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid references public.communication_threads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  provider text not null,
  external_message_id text,
  direction text check (direction in ('inbound', 'outbound', 'internal', 'unknown')),
  sent_at timestamptz,
  body_text text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

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

create table if not exists public.cognitive_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  profile_version integer not null default 1,
  global_confidence integer not null default 0 check (global_confidence between 0 and 100),
  summary text,
  updated_from text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_id, profile_version)
);

create table if not exists public.behavioral_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  profile_id uuid references public.cognitive_profiles(id) on delete set null,
  signal_type text not null,
  text text not null,
  inference text,
  inference_level text not null check (inference_level in ('observable', 'inferred', 'hypothetical', 'unavailable')),
  confidence integer not null default 0 check (confidence between 0 and 100),
  source_type text not null,
  source_ref text,
  observed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.interaction_axis_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.cognitive_profiles(id) on delete cascade,
  axis text not null check (axis in ('relation_result', 'intuition_structure', 'caution_speed', 'consensus_control')),
  value integer not null check (value between 0 and 100),
  confidence integer not null check (confidence between 0 and 100),
  inference_level text not null check (inference_level in ('observable', 'inferred', 'hypothetical', 'unavailable')),
  evidence_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.interaction_mode_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.cognitive_profiles(id) on delete cascade,
  mode text not null check (mode in ('Challenger', 'Validator', 'Strategist', 'Operator', 'Consensus Builder', 'Explorer')),
  score integer not null check (score between 0 and 100),
  confidence integer not null check (confidence between 0 and 100),
  evidence_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.relationship_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_contact_id uuid not null references public.contacts(id) on delete cascade,
  to_contact_id uuid not null references public.contacts(id) on delete cascade,
  relation_type text not null default 'unknown' check (relation_type in ('reports_to', 'influences', 'validates', 'blocks', 'collaborates_with', 'unknown')),
  strength integer not null default 0 check (strength between 0 and 100),
  confidence integer not null default 0 check (confidence between 0 and 100),
  source_type text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  brief_type text not null check (brief_type in ('commercial', 'partnership', 'productivity')),
  status text not null default 'queued' check (status in ('queued', 'generating', 'ready', 'failed', 'insufficient_data')),
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  content jsonb not null default '{}',
  sources jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brief_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_id uuid not null references public.briefs(id) on delete cascade,
  section text not null,
  text text not null,
  confidence integer not null default 0 check (confidence between 0 and 100),
  inference_level text not null check (inference_level in ('observable', 'inferred', 'hypothetical', 'unavailable')),
  source_refs text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.privacy_settings enable row level security;
alter table public.connectors enable row level security;
alter table public.oauth_accounts enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.communication_threads enable row level security;
alter table public.communication_messages enable row level security;
alter table public.meeting_transcripts enable row level security;
alter table public.cognitive_profiles enable row level security;
alter table public.behavioral_signals enable row level security;
alter table public.interaction_axis_scores enable row level security;
alter table public.interaction_mode_scores enable row level security;
alter table public.relationship_edges enable row level security;
alter table public.briefs enable row level security;
alter table public.brief_insights enable row level security;
alter table public.notes enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_self" on public.profiles for select using (id = auth.uid());
create policy "profiles_update_self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_insert_self" on public.profiles for insert with check (id = auth.uid());

create policy "organizations_member_select" on public.organizations for select using (public.is_org_member(id));
create policy "memberships_member_select" on public.memberships for select using (public.is_org_member(organization_id));

create policy "notification_preferences_owner" on public.notification_preferences
  for all using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy "privacy_settings_owner" on public.privacy_settings
  for all using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy "connectors_owner" on public.connectors
  for all using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy "oauth_accounts_owner" on public.oauth_accounts
  for select using (
    exists (
      select 1 from public.connectors c
      where c.id = connector_id and c.user_id = auth.uid() and public.is_org_member(c.organization_id)
    )
  );

create policy "audit_logs_insert_member" on public.audit_logs
  for insert with check (public.is_org_member(organization_id));
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.is_org_admin(organization_id));

create policy "sync_jobs_member_select" on public.sync_jobs for select using (public.is_org_member(organization_id));

create policy "companies_member_all" on public.companies
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "contacts_member_all" on public.contacts
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "meetings_member_all" on public.meetings
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "meeting_participants_member_all" on public.meeting_participants
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "communication_threads_member_select" on public.communication_threads
  for select using (public.is_org_member(organization_id));
create policy "communication_messages_member_select" on public.communication_messages
  for select using (public.is_org_member(organization_id));
create policy "meeting_transcripts_member_select" on public.meeting_transcripts
  for select using (public.is_org_member(organization_id));

create policy "cognitive_profiles_member_all" on public.cognitive_profiles
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "behavioral_signals_member_all" on public.behavioral_signals
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "interaction_axis_scores_member_all" on public.interaction_axis_scores
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "interaction_mode_scores_member_all" on public.interaction_mode_scores
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "relationship_edges_member_all" on public.relationship_edges
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "briefs_member_all" on public.briefs
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "brief_insights_member_all" on public.brief_insights
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "notes_member_all" on public.notes
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists contacts_org_email_idx on public.contacts(organization_id, email);
create index if not exists meetings_org_starts_at_idx on public.meetings(organization_id, starts_at);
create index if not exists behavioral_signals_contact_idx on public.behavioral_signals(contact_id, created_at desc);
create index if not exists cognitive_profiles_contact_idx on public.cognitive_profiles(contact_id, profile_version desc);
create index if not exists briefs_meeting_idx on public.briefs(meeting_id, created_at desc);
