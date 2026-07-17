do $$
begin
  if not exists (select 1 from vault.secrets where name = 'tohu_oauth_token_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'tohu_oauth_token_encryption_key',
      'Clé de chiffrement des jetons OAuth Tohu'
    );
  end if;
end;
$$;

create or replace function public.store_oauth_tokens_server(
  p_organization_id uuid,
  p_connector_id uuid,
  p_provider_account_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  encryption_key text;
  encrypted_access text;
  encrypted_refresh text;
begin
  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'tohu_oauth_token_encryption_key'
  limit 1;

  if encryption_key is null then
    raise exception 'OAuth encryption key unavailable';
  end if;

  encrypted_access := encode(extensions.pgp_sym_encrypt(p_access_token, encryption_key), 'base64');
  encrypted_refresh := case
    when p_refresh_token is null or p_refresh_token = '' then null
    else encode(extensions.pgp_sym_encrypt(p_refresh_token, encryption_key), 'base64')
  end;

  insert into public.oauth_accounts (
    organization_id, connector_id, provider_account_id,
    encrypted_access_token, encrypted_refresh_token, expires_at, updated_at
  ) values (
    p_organization_id, p_connector_id, p_provider_account_id,
    encrypted_access, encrypted_refresh, p_expires_at, now()
  )
  on conflict (connector_id) do update set
    organization_id = excluded.organization_id,
    provider_account_id = excluded.provider_account_id,
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, public.oauth_accounts.encrypted_refresh_token),
    expires_at = excluded.expires_at,
    updated_at = now();
end;
$$;

create or replace function public.get_oauth_tokens_server(p_connector_id uuid)
returns table (
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  oauth_account_id uuid,
  provider_account_id text
)
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  encryption_key text;
begin
  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'tohu_oauth_token_encryption_key'
  limit 1;

  if encryption_key is null then
    raise exception 'OAuth encryption key unavailable';
  end if;

  return query
  select
    extensions.pgp_sym_decrypt(decode(oa.encrypted_access_token, 'base64'), encryption_key),
    case when oa.encrypted_refresh_token is null then null
      else extensions.pgp_sym_decrypt(decode(oa.encrypted_refresh_token, 'base64'), encryption_key)
    end,
    oa.expires_at,
    oa.id,
    oa.provider_account_id
  from public.oauth_accounts oa
  where oa.connector_id = p_connector_id;
end;
$$;

revoke all on function public.store_oauth_tokens_server(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_oauth_tokens_server(uuid)
  from public, anon, authenticated;
grant execute on function public.store_oauth_tokens_server(uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.get_oauth_tokens_server(uuid)
  to service_role;
