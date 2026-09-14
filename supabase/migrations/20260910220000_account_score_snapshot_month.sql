-- Sépare la période historique représentée par un snapshot (snapshot_month)
-- de la date de calcul technique (computed_at). Jusqu'ici, score-batch
-- détournait computed_at pour simuler une date passée pendant un deepBackfill
-- (now - ma*30 jours) : cette approximation en multiples de 30 jours dérive
-- des vrais mois calendaires et peut faire tomber deux `ma` différents dans
-- le même mois civil, produisant deux snapshots contradictoires pour "le
-- même mois" (ex. Limayrac mars 2026 : score 75/coverage 100% ET score
-- 58/coverage 33% écrits par le même run). Voir score-batch/index.ts pour le
-- correctif du calcul (arithmétique calendaire réelle + upsert).
--
-- snapshot_month = premier jour du mois civil représenté (UTC), explicite et
-- non ambigu. computed_at continue de représenter le moment technique du
-- calcul (désormais toujours réel, plus jamais antidaté).

alter table public.account_relationship_score_snapshots
  add column if not exists snapshot_month date;

-- Backfill : le mois calendaire de computed_at est la meilleure information
-- disponible sur la période visée par chaque snapshot existant (deepBackfill
-- antidatait déjà computed_at pour simuler "le mois ma-fois-30-jours plus
-- tôt" — tronquer au mois civil retombe sur l'intention réelle, y compris
-- pour les lignes en collision ci-dessous).
update public.account_relationship_score_snapshots
set snapshot_month = date_trunc('month', computed_at at time zone 'utc')::date
where snapshot_month is null;

-- Nettoyage déterministe des doublons "même compte, même mois civil, même
-- version de formule" causés par le bug de bucketing ci-dessus (et par les
-- ré-écritures répétées du cron 6h sans upsert, insert-only jusqu'ici).
-- Règle : on garde le snapshot le plus COMPLET, jamais le "premier" ou le
-- "dernier" au hasard — contact_coverage désc (a vu le plus de contacts du
-- compte), puis total_interactions désc (signal le plus riche), puis
-- confidence désc, puis id comme dernier départage stable (ordre total : au
-- plus une ligne par groupe a rn=1, un groupe de taille 1 n'est jamais
-- touché). Sur les 5 comptes de production audités, cette règle fait
-- toujours converger vers le score actuellement affiché en carte/tableau
-- (vérifié avant application) : aucune régression visible sur le score
-- courant. Réconciliation avant application : 78 lignes totales, 20 groupes
-- (compte+mois+version) distincts, 6 groupes déjà uniques (jamais touchés),
-- 14 groupes en doublon totalisant 72 lignes → 58 lignes supprimées,
-- 20 conservées (6 + 14). 20 + 58 = 78.
-- (pas de ON COMMIT DROP : si le runner de migration exécute chaque
-- instruction en autocommit plutôt que dans une seule transaction explicite,
-- la table temporaire serait supprimée avant d'être réutilisée par les
-- instructions suivantes — on la supprime nous-mêmes à la fin, explicitement.)
create temporary table _dedup_ids_to_delete as
select id from (
  select id,
    row_number() over (
      partition by organization_id, company_id, snapshot_month, model_version
      order by contact_coverage desc nulls last, total_interactions desc nulls last, confidence desc nulls last, id
    ) as rn
  from public.account_relationship_score_snapshots
) ranked
where rn > 1;

-- Sauvegarde complète et restaurable des lignes supprimées, calculée sur EXACTEMENT
-- le même ensemble d'ids que le DELETE ci-dessous (même table temporaire) — pour
-- restaurer intégralement en cas de problème :
--   insert into public.account_relationship_score_snapshots
--   select * from public.account_relationship_score_snapshots_dedup_backup_20260910;
create table public.account_relationship_score_snapshots_dedup_backup_20260910 as
select s.* from public.account_relationship_score_snapshots s
join _dedup_ids_to_delete d on d.id = s.id;
comment on table public.account_relationship_score_snapshots_dedup_backup_20260910 is
  'Sauvegarde des 58 lignes supprimées par la migration 20260910220000 (doublons compte+mois issus du bug de bucketing 30 jours) — à conserver le temps de valider la correction en production, supprimable ensuite.';
revoke all on public.account_relationship_score_snapshots_dedup_backup_20260910 from anon, authenticated;

delete from public.account_relationship_score_snapshots s
using _dedup_ids_to_delete d
where s.id = d.id;

drop table _dedup_ids_to_delete;

alter table public.account_relationship_score_snapshots
  alter column snapshot_month set not null;

-- Un seul snapshot de référence par organisation+compte+mois+version de
-- formule : score-batch doit désormais UPSERT dessus (ON CONFLICT), plus
-- jamais un simple insert — sinon cette contrainte casserait le cron.
create unique index if not exists account_relationship_score_snapshots_period_uidx
  on public.account_relationship_score_snapshots (organization_id, company_id, snapshot_month, model_version);

create index if not exists account_score_company_month_idx
  on public.account_relationship_score_snapshots (company_id, snapshot_month desc);
