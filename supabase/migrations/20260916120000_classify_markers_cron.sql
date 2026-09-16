-- Généralise l'invocation de classify-markers (classificateur sémantique à
-- registre fermé, déployé mais jamais appelé jusqu'ici — cf. audit) à TOUTES
-- les organisations, en cron. Positionné entre detect-dyad-markers (:10,
-- déterministe) et score-batch-account-v6 (:20, agrégation compte) pour que
-- les marker_events sémantiques du jour soient déjà en base avant l'agrégation.
select cron.schedule(
  'tohu-bohu-classify-markers',
  '13 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/classify-markers',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name='monitor_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
