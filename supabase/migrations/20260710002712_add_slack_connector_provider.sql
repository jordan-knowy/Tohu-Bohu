alter table public.connectors drop constraint connectors_provider_check;
alter table public.connectors add constraint connectors_provider_check
  check (provider = ANY (ARRAY['google','microsoft','linkedin','hubspot','salesforce','pipedrive','attio','zoom','teams','slack']::text[]));
