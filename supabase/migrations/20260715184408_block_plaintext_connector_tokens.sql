create or replace function private.sanitize_connector_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    - 'access_token'
    - 'refresh_token'
    - 'provider_token'
    - 'provider_refresh_token'
    - 'microsoft_token'
    - 'google_token';
  return new;
end;
$$;

drop trigger if exists sanitize_connector_metadata_tokens on public.connectors;
create trigger sanitize_connector_metadata_tokens
before insert or update of metadata on public.connectors
for each row execute function private.sanitize_connector_metadata();

comment on function private.sanitize_connector_metadata() is
  'Empêche tout stockage accidentel de jetons OAuth en clair dans connectors.metadata.';
