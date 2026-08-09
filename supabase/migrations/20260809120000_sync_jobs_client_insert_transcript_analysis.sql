-- Permet au client de pré-créer une ligne sync_jobs (job_type strictement
-- 'transcript_analysis') avant d'invoquer l'edge function ingest-transcript,
-- afin de sonder la progression de l'ingestion + analyse comportementale
-- pendant que l'appel HTTP est encore en vol (même mécanisme que pour
-- l'analyse email, cf. 20260722090000). L'edge function (service_role)
-- complète ensuite cette ligne à chaque étape réelle (parsing → réunion →
-- intervenants → analyse i/N → terminé).
--
-- Insertion volontairement minimale côté client : organization_id, user_id,
-- job_type et status='queued' ; l'edge function renseigne le reste
-- (provider, current_step, progress, payload) via service_role.

drop policy if exists sync_jobs_member_insert_transcript_analysis on public.sync_jobs;
create policy sync_jobs_member_insert_transcript_analysis on public.sync_jobs
for insert to authenticated
with check (
  job_type = 'transcript_analysis'
  and user_id = (select auth.uid())
  and status = 'queued'
  and private.is_org_member(organization_id)
);

notify pgrst, 'reload schema';
