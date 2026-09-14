-- Synchronisation calendrier périodique (Google Calendar / Microsoft 365), sans
-- dépendance à un clic manuel — même pattern que tohu-bohu-meeting-prep
-- (20260907120000_schedule_meeting_prep_emails.sql) : net.http_post + x-cron-secret
-- depuis app_secrets. Décalés de 3 min pour étaler la charge réseau/API.
-- Toutes les 15 min : cohérent avec la fenêtre T-2h/5min du briefing (les
-- rendez-vous doivent être à jour dans `meetings` bien avant que send-meeting-prep
-- n'ait besoin de les lire).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tohu-bohu-google-calendar-sync') then
    perform cron.unschedule('tohu-bohu-google-calendar-sync');
  end if;
  if exists (select 1 from cron.job where jobname = 'tohu-bohu-microsoft-calendar-sync') then
    perform cron.unschedule('tohu-bohu-microsoft-calendar-sync');
  end if;
end $$;

select cron.schedule(
  'tohu-bohu-google-calendar-sync',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/sync-google-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

select cron.schedule(
  'tohu-bohu-microsoft-calendar-sync',
  '3-59/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/sync-microsoft-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

select jobid, jobname, schedule, active
from cron.job
where jobname in ('tohu-bohu-google-calendar-sync', 'tohu-bohu-microsoft-calendar-sync');
