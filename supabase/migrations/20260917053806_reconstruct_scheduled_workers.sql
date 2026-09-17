-- Reproduce the observed 17 job names, schedules and targets without embedding
-- a project URL or JWT. Legacy responsibilities are retained until Phase 5.
-- Runtime setup (outside Git): app_secrets.edge_base_url, edge_gateway_key,
-- monitor_cron. Missing configuration fails closed before any HTTP request.
create or replace function private.dispatch_scheduled_edge(p_slug text, p_body jsonb default '{}'::jsonb, p_timeout integer default 1000)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,net as $$
declare base_url text; gateway_key text; cron_secret text;
begin
  select value into base_url from public.app_secrets where name='edge_base_url';
  select value into gateway_key from public.app_secrets where name='edge_gateway_key';
  select value into cron_secret from public.app_secrets where name='monitor_cron';
  if nullif(base_url,'') is null or nullif(gateway_key,'') is null or nullif(cron_secret,'') is null then
    raise exception 'SCHEDULED_WORKER_CONFIG_MISSING';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]*$' or jsonb_typeof(p_body) is distinct from 'object'
    or p_timeout is null or p_timeout < 1 or p_timeout > 60000 then
    raise exception 'INVALID_SCHEDULED_WORKER_REQUEST';
  end if;
  return net.http_post(url := rtrim(base_url,'/') || '/functions/v1/' || p_slug,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || gateway_key,'x-cron-secret',cron_secret),
    body := p_body, timeout_milliseconds := p_timeout);
end $$;
revoke all on function private.dispatch_scheduled_edge(text,jsonb,integer) from public,anon,authenticated;
grant execute on function private.dispatch_scheduled_edge(text,jsonb,integer) to service_role;

select cron.schedule('tohu-bohu-alerts', '50 */6 * * *', $job$select private.dispatch_scheduled_edge('send-alerts', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-briefs', '*/30 * * * *', $job$select private.dispatch_scheduled_edge('generate-briefs', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-classify-markers', '13 */6 * * *', $job$select private.dispatch_scheduled_edge('classify-markers', '{}'::jsonb, 60000);$job$);
select cron.schedule('tohu-bohu-contact-avatars', '30 */2 * * *', $job$select private.dispatch_scheduled_edge('enrich-contact-avatars', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-detect-dyad-markers', '10 */6 * * *', $job$select private.dispatch_scheduled_edge('detect-dyad-markers', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-digest', '*/15 * * * *', $job$select private.dispatch_scheduled_edge('generate-briefs', '{"mode":"digest"}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-email-backfill', '45 */6 * * *', $job$select private.dispatch_scheduled_edge('sync-email-analysis', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-email-incremental', '*/10 * * * *', $job$select private.dispatch_scheduled_edge('sync-email-analysis', '{"mode":"incremental"}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-google-calendar-sync', '*/15 * * * *', $job$select private.dispatch_scheduled_edge('sync-google-calendar', '{}'::jsonb, 60000);$job$);
select cron.schedule('tohu-bohu-meeting-prep', '*/5 * * * *', $job$select private.dispatch_scheduled_edge('send-meeting-prep', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-microsoft-calendar-sync', '3-59/15 * * * *', $job$select private.dispatch_scheduled_edge('sync-microsoft-calendar', '{}'::jsonb, 60000);$job$);
select cron.schedule('tohu-bohu-nurturing', '0 7 * * *', $job$select private.dispatch_scheduled_edge('send-nurturing', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-score', '15 */6 * * *', $job$select private.dispatch_scheduled_edge('score-batch', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-score-v6-account', '20 */6 * * *', $job$select private.dispatch_scheduled_edge('score-batch-account-v6', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-veille-auto', '0 */6 * * *', $job$select private.dispatch_scheduled_edge('monitor-company-news', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-veille-contacts', '30 */6 * * *', $job$select private.dispatch_scheduled_edge('monitor-contacts', '{}'::jsonb, 1000);$job$);
select cron.schedule('tohu-bohu-weekly-digest', '0 6 * * 1', $job$select private.dispatch_scheduled_edge('send-weekly-digest', '{}'::jsonb, 1000);$job$);
