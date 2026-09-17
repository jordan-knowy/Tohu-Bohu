begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select pg_temp.assert_true((select count(*)=17 from cron.job where jobname like 'tohu-bohu-%'),'17 observed jobs reconstructed');
select pg_temp.assert_true((select count(*)=0 from cron.job where command ~ 'eyJ|bgmtzwfafcgjklgygvtx'),'no project-bound token or URL in effective jobs');
select pg_temp.assert_true((select count(*)=17 from cron.job where command like '%private.dispatch_scheduled_edge%'),'all jobs use configured dispatcher');
select pg_temp.assert_true(not has_function_privilege('authenticated','private.dispatch_scheduled_edge(text,jsonb,integer)','EXECUTE'),'users cannot dispatch privileged workers');
select pg_temp.assert_true(not has_function_privilege('anon','private.dispatch_scheduled_edge(text,jsonb,integer)','EXECUTE'),'anonymous cannot dispatch privileged workers');
-- No request may be enqueued if a blank rebuild has not been configured.
do $$ begin
 begin
  perform private.dispatch_scheduled_edge('detect-dyad-markers');
  raise exception 'FAIL: missing config accepted';
 exception when raise_exception then
  if sqlerrm <> 'SCHEDULED_WORKER_CONFIG_MISSING' then raise; end if;
 end;
end $$;
rollback;
\echo 'PASS: deterministic cron reconstruction and fail-closed runtime configuration'
