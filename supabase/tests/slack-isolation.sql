-- Run ONLY in an empty disposable PostgreSQL database:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/slack-isolation.sql
begin;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select current_setting('test.user_id', true)::uuid $$;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key);
create table public.connectors(id uuid primary key);
create table public.communication_messages(id uuid primary key, organization_id uuid, provider text, contact_id uuid, body_text text);
create table public.communication_threads(id uuid primary key, organization_id uuid, provider text);
alter table public.communication_messages enable row level security;
alter table public.communication_threads enable row level security;
create policy org_member on public.communication_messages for select to authenticated using (true);
create policy org_member on public.communication_threads for select to authenticated using (true);
create policy org_update on public.communication_messages for update to authenticated using (true) with check (true);
grant usage on schema public, auth to authenticated, service_role;
grant select, update on public.communication_messages, public.communication_threads to authenticated;
\ir ../migrations/20260908160000_slack_sync.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into connectors values ('00000000-0000-0000-0000-000000000003');
insert into communication_messages(id,provider,source_owner_user_id) values
('00000000-0000-0000-0000-000000000011','slack','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000012','slack',null),
('00000000-0000-0000-0000-000000000013','google',null);
insert into communication_threads(id,provider,source_owner_user_id) values
('00000000-0000-0000-0000-000000000021','slack','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000022','slack',null);
set role authenticated;
set test.user_id = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from communication_messages) <> 2 then raise exception 'Private messages leaked'; end if;
  if (select count(*) from communication_threads) <> 1 then raise exception 'Private threads leaked'; end if;
  begin
    perform * from connector_sync_state;
    raise exception 'Server state leaked';
  exception when insufficient_privilege then null; end;
  begin
    perform * from connector_oauth_states;
    raise exception 'OAuth nonces leaked';
  exception when insufficient_privilege then null; end;
  begin
    perform claim_connector_sync('00000000-0000-0000-0000-000000000003',gen_random_uuid());
    raise exception 'Client claimed server lock';
  exception when insufficient_privilege then null; end;
end $$;
set test.user_id = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from communication_messages) <> 3 then raise exception 'Owner cannot read private messages'; end if;
  begin
    update communication_messages set source_owner_user_id = null where id = '00000000-0000-0000-0000-000000000011';
    raise exception 'Client can expose private messages';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    update communication_messages set contact_id = gen_random_uuid() where id = '00000000-0000-0000-0000-000000000011';
    raise exception 'Private activity can enter shared contact aggregation';
  exception when check_violation then null; end;
end $$;
set role service_role;
do $$ begin
  if not claim_connector_sync('00000000-0000-0000-0000-000000000003',gen_random_uuid()) then raise exception 'Cannot acquire lock'; end if;
  if claim_connector_sync('00000000-0000-0000-0000-000000000003',gen_random_uuid()) then raise exception 'Concurrent lock acquired'; end if;
  update connector_sync_state set lease_until = now() - interval '1 second';
  if not claim_connector_sync('00000000-0000-0000-0000-000000000003',gen_random_uuid()) then raise exception 'Expired lock not reclaimed'; end if;
end $$;
reset role;
rollback;
\echo 'Slack migration, RLS and lease assertions passed.'
