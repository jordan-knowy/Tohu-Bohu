-- Initial V6 ingestion schedule, installed before the provenance correction.
select cron.unschedule(jobid)
from cron.job
where jobname = 'tohu-bohu-v6-ingest-events';

select cron.schedule(
  'tohu-bohu-v6-ingest-events',
  '5 */6 * * *',
  $job$select private.dispatch_scheduled_edge('v6-ingest-events', '{"recent":true}'::jsonb, 60000);$job$
);
