do $$
declare
  connector_row record;
begin
  for connector_row in
    select id, organization_id, user_id, metadata
    from public.connectors
    where metadata ? 'access_token'
  loop
    perform public.store_oauth_tokens_server(
      connector_row.organization_id,
      connector_row.id,
      coalesce(connector_row.metadata->>'provider_account_id', connector_row.user_id::text),
      connector_row.metadata->>'access_token',
      nullif(connector_row.metadata->>'refresh_token', ''),
      now() + interval '30 minutes'
    );
  end loop;

  update public.connectors
  set metadata = coalesce(metadata, '{}'::jsonb)
    - 'access_token'
    - 'refresh_token'
    - 'provider_token'
    - 'provider_refresh_token',
    updated_at = now()
  where metadata ?| array['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token'];
end;
$$;
