-- Provider state is server-only: OAuth nonces, pagination and Slack identities.
create table public.connector_sync_state (
  connector_id uuid primary key references public.connectors(id) on delete cascade,
  state jsonb not null default '{}',
  lease_until timestamptz,
  lease_id uuid
);
alter table public.connector_sync_state enable row level security;
revoke all on public.connector_sync_state from anon, authenticated;
create table public.connector_oauth_states (
  nonce uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.connector_oauth_states enable row level security;
revoke all on public.connector_oauth_states from anon, authenticated;

create function public.claim_connector_sync(p_connector_id uuid, p_lease_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into connector_sync_state(connector_id) values(p_connector_id) on conflict do nothing;
  update connector_sync_state set lease_until = now() + interval '3 minutes', lease_id = p_lease_id
  where connector_id = p_connector_id and (lease_until is null or lease_until < now());
  return found;
end $$;
revoke all on function public.claim_connector_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_connector_sync(uuid, uuid) to service_role;

-- Private Slack records never enter shared person/account enrichment. Even their
-- metadata is readable only by the importing user (restrictive AND existing RLS).
alter table public.communication_messages add column source_owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.communication_threads add column source_owner_user_id uuid references auth.users(id) on delete cascade;
create policy slack_messages_private on public.communication_messages as restrictive for all to authenticated
using (provider <> 'slack' or source_owner_user_id is null or source_owner_user_id = auth.uid())
with check (provider <> 'slack');
create policy slack_threads_private on public.communication_threads as restrictive for all to authenticated
using (provider <> 'slack' or source_owner_user_id is null or source_owner_user_id = auth.uid())
with check (provider <> 'slack');

grant all on public.connector_sync_state, public.connector_oauth_states to service_role;
alter table public.communication_messages add constraint slack_private_no_shared_content
check (provider <> 'slack' or source_owner_user_id is null or (contact_id is null and body_text is null));
