-- Active RLS sur la table de sauvegarde du dédoublonnage (migration
-- 20260910220000). Elle n'a pas vocation à être accessible par les
-- utilisateurs de l'application : anon/authenticated n'ont déjà aucun droit
-- dessus (revoke dans la migration précédente), RLS ferme l'accès par défaut
-- même si un droit y était accordé par erreur plus tard. service_role a
-- rolbypassrls = true (vérifié) : les opérations d'administration (migrations,
-- restauration éventuelle) restent possibles sans policy dédiée.
alter table public.account_relationship_score_snapshots_dedup_backup_20260910 enable row level security;
