-- Planifie le batch Météo du compte V6 (scoring.score_snapshot, entity_type='account').
-- Même mécanique que le cron existant tohu-bohu-score (score legacy) : décalé de
-- 5 minutes pour ne jamais tourner en même temps que lui sur la même instance.
select cron.schedule(
  'tohu-bohu-score-v6-account',
  '20 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/score-batch-account-v6',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name='monitor_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);
