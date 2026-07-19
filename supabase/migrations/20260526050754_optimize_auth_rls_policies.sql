drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "notification_preferences_owner" on public.notification_preferences;
drop policy if exists "privacy_settings_owner" on public.privacy_settings;
drop policy if exists "connectors_owner" on public.connectors;
drop policy if exists "oauth_accounts_owner" on public.oauth_accounts;

create policy "profiles_select_self" on public.profiles
  for select using (id = (select auth.uid()));
create policy "profiles_update_self" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = (select auth.uid()));

create policy "notification_preferences_owner" on public.notification_preferences
  for all using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

create policy "privacy_settings_owner" on public.privacy_settings
  for all using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

create policy "connectors_owner" on public.connectors
  for all using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

create policy "oauth_accounts_owner" on public.oauth_accounts
  for select using (
    exists (
      select 1 from public.connectors c
      where c.id = connector_id and c.user_id = (select auth.uid()) and public.is_org_member(c.organization_id)
    )
  );
