-- Rebranding : les crons portaient encore le nom historique "knowr" (ancien nom du
-- produit). Le produit s'appelle Tohu-Bohu — on renomme les jobs en conséquence.
-- pg_cron n'a pas de RENAME : on désinscrit l'ancien nom et on replanifie à
-- l'identique (même schedule, même appel) sous le nouveau nom.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'knowr-veille-auto') then
    perform cron.unschedule('knowr-veille-auto');
  end if;
  if exists (select 1 from cron.job where jobname = 'knowr-score') then
    perform cron.unschedule('knowr-score');
  end if;
  if exists (select 1 from cron.job where jobname = 'knowr-veille-contacts') then
    perform cron.unschedule('knowr-veille-contacts');
  end if;
end $$;

select cron.schedule(
  'tohu-bohu-veille-auto',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/monitor-company-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tohu-bohu-score',
  '15 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/score-batch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name='monitor_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tohu-bohu-veille-contacts',
  '30 */6 * * *',
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

select jobid, jobname, schedule, active from cron.job order by jobname;
