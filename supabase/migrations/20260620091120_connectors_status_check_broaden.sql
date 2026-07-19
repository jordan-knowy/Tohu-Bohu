alter table public.connectors drop constraint if exists connectors_status_check;
alter table public.connectors add constraint connectors_status_check
  check (status = any (array[
    'not_connected'::text, 'connected'::text, 'expired'::text,
    'error'::text, 'revoked'::text, 'needs_reauth'::text, 'disconnected'::text
  ]));
