create schema if not exists private;

grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_org_member(target_org_id uuid)
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
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_org_admin(target_org_id uuid)
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
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function private.is_org_admin(uuid) to anon, authenticated, service_role;

-- Recreate every policy that depends on organization membership helpers.
drop policy if exists "organizations_member_select" on public.organizations;
drop policy if exists "memberships_member_select" on public.memberships;
drop policy if exists "notification_preferences_owner" on public.notification_preferences;
drop policy if exists "privacy_settings_owner" on public.privacy_settings;
drop policy if exists "connectors_owner" on public.connectors;
drop policy if exists "oauth_accounts_owner" on public.oauth_accounts;
drop policy if exists "audit_logs_insert_member" on public.audit_logs;
drop policy if exists "audit_logs_select_admin" on public.audit_logs;
drop policy if exists "sync_jobs_member_select" on public.sync_jobs;
drop policy if exists "companies_member_all" on public.companies;
drop policy if exists "contacts_member_all" on public.contacts;
drop policy if exists "meetings_member_all" on public.meetings;
drop policy if exists "meeting_participants_member_all" on public.meeting_participants;
drop policy if exists "communication_threads_member_select" on public.communication_threads;
drop policy if exists "communication_messages_member_select" on public.communication_messages;
drop policy if exists "meeting_transcripts_member_select" on public.meeting_transcripts;
drop policy if exists "cognitive_profiles_member_all" on public.cognitive_profiles;
drop policy if exists "behavioral_signals_member_all" on public.behavioral_signals;
drop policy if exists "interaction_axis_scores_member_all" on public.interaction_axis_scores;
drop policy if exists "interaction_mode_scores_member_all" on public.interaction_mode_scores;
drop policy if exists "relationship_edges_member_all" on public.relationship_edges;
drop policy if exists "briefs_member_all" on public.briefs;
drop policy if exists "brief_insights_member_all" on public.brief_insights;
drop policy if exists "notes_member_all" on public.notes;

create policy "organizations_member_select" on public.organizations for select using (private.is_org_member(id));
create policy "memberships_member_select" on public.memberships for select using (private.is_org_member(organization_id));

create policy "notification_preferences_owner" on public.notification_preferences
  for all using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create policy "privacy_settings_owner" on public.privacy_settings
  for all using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create policy "connectors_owner" on public.connectors
  for all using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create policy "oauth_accounts_owner" on public.oauth_accounts
  for select using (
    exists (
      select 1 from public.connectors c
      where c.id = connector_id and c.user_id = (select auth.uid()) and private.is_org_member(c.organization_id)
    )
  );

create policy "audit_logs_insert_member" on public.audit_logs
  for insert with check (private.is_org_member(organization_id));
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (private.is_org_admin(organization_id));

create policy "sync_jobs_member_select" on public.sync_jobs for select using (private.is_org_member(organization_id));

create policy "companies_member_all" on public.companies
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "contacts_member_all" on public.contacts
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "meetings_member_all" on public.meetings
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "meeting_participants_member_all" on public.meeting_participants
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy "communication_threads_member_select" on public.communication_threads
  for select using (private.is_org_member(organization_id));
create policy "communication_messages_member_select" on public.communication_messages
  for select using (private.is_org_member(organization_id));
create policy "meeting_transcripts_member_select" on public.meeting_transcripts
  for select using (private.is_org_member(organization_id));

create policy "cognitive_profiles_member_all" on public.cognitive_profiles
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "behavioral_signals_member_all" on public.behavioral_signals
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "interaction_axis_scores_member_all" on public.interaction_axis_scores
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "interaction_mode_scores_member_all" on public.interaction_mode_scores
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "relationship_edges_member_all" on public.relationship_edges
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy "briefs_member_all" on public.briefs
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "brief_insights_member_all" on public.brief_insights
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "notes_member_all" on public.notes
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop function if exists public.is_org_member(uuid);
drop function if exists public.is_org_admin(uuid);
