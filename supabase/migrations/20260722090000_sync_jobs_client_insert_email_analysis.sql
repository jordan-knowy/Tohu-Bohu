-- Permet au client de pré-créer une ligne sync_jobs (job_type strictement
-- 'email_behavior_analysis') avant d'invoquer l'edge function sync-email-analysis,
-- pour pouvoir sonder sa progression pendant que l'appel HTTP est encore en vol
-- (sans ça, aucune lecture possible avant la résolution complète de la requête,
-- puisque celle-ci ne renvoie qu'une seule réponse finale). L'edge function
-- (service_role) complète ensuite cette ligne à chaque étape réelle.
--
-- Insertion volontairement minimale côté client : seuls organization_id, user_id,
-- job_type et status='queued' sont nécessaires, l'edge function renseigne le reste
-- (connector_id, provider, current_step, progress, payload) via service_role.

drop policy if exists sync_jobs_member_insert_email_analysis on public.sync_jobs;
create policy sync_jobs_member_insert_email_analysis on public.sync_jobs
for insert to authenticated
with check (
  job_type = 'email_behavior_analysis'
  and user_id = (select auth.uid())
  and status = 'queued'
  and private.is_org_member(organization_id)
);

grant insert on public.sync_jobs to authenticated;

notify pgrst, 'reload schema';
