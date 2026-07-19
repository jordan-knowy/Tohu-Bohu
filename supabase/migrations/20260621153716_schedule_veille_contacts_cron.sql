do $$
begin
  if exists (select 1 from cron.job where jobname = 'knowr-veille-contacts') then
    perform cron.unschedule('knowr-veille-contacts');
  end if;
end $$;

select cron.schedule(
  'knowr-veille-contacts',
  '30 */12 * * *',
  $$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/monitor-contacts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);
select jobname, schedule, active from cron.job where jobname='knowr-veille-contacts';
