-- Envoie l'antisèche brandée Tohu environ deux heures avant chaque réunion.
-- Le job passe toutes les cinq minutes ; l'Edge Function applique les préférences
-- de l'utilisateur et déduplique chaque envoi avec `antiseche:{meeting_id}`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tohu-bohu-meeting-prep') then
    perform cron.unschedule('tohu-bohu-meeting-prep');
  end if;
end $$;

select cron.schedule(
  'tohu-bohu-meeting-prep',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/send-meeting-prep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb
  );
  $job$
);

select jobid, jobname, schedule, active
from cron.job
where jobname = 'tohu-bohu-meeting-prep';
