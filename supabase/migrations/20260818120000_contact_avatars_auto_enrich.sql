-- Enrichissement AUTOMATIQUE des photos de fiches Personne.
--
-- Jusqu'ici, l'enrichissement (Gravatar → logo d'entreprise → initiales) ne
-- tournait qu'au clic « Synchroniser ». Or les contacts sont découverts
-- automatiquement (cron email). On rend donc l'enrichissement automatique via
-- un cron dédié, pour que tout NOUVEAU contact récupère sa photo sans action.

-- 1) Horodatage des tentatives : évite de re-solliciter sans fin les emails
--    qui n'ont ni Gravatar ni logo (on ne re-teste qu'après ~30 jours).
alter table public.contacts add column if not exists avatar_checked_at timestamptz;

-- File d'attente d'enrichissement (petit index partiel : contacts sans avatar).
create index if not exists contacts_avatar_pending_idx
  on public.contacts (avatar_checked_at)
  where avatar_url is null and merged_into_contact_id is null;

-- 2) Cron toutes les 2 h → enrich-contact-avatars en mode cron (x-cron-secret).
--    Même mécanisme que les autres crons (Authorization anon + secret monitor_cron).
do $$
begin
  perform cron.unschedule('tohu-bohu-contact-avatars');
exception when others then null;
end
$$;

select cron.schedule('tohu-bohu-contact-avatars', '30 */2 * * *', $job$
  select net.http_post(
    url := 'https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/enrich-contact-avatars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbXR6d2ZhZmNnamtsZ3lndnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzMxMDUsImV4cCI6MjA5NTMwOTEwNX0.IUavWyVakW9dSKP9oqCxeciSi5nLduu6Lu9qr-Cp1v8',
      'x-cron-secret', (select value from public.app_secrets where name = 'monitor_cron')
    ),
    body := '{}'::jsonb
  );
$job$);
