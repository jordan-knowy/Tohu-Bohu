# Phase 1 — remédiation et reconstruction

## Résumé

17 septembre 2026. **Phase 1 : GO. Reconstruction des fondations nécessaires à V6 depuis Git : YES. GO Phase 2.** Ce verdict valide la fondation shadow et son cadre d’évaluation, pas un moteur produit terminé, une précision sémantique ni l’absence de Legacy. Les phases 2 à 6 restent nécessaires.

Le mandat global a autorisé les corrections après l’inspection initiale. `PHASE_1_ETAT_DISTANT.md` et ses captures restent la référence de l’état avant correction.

## Travail réalisé

**VERIFIED LOCAL** : les 139 migrations initiales sont conservées ; leurs cinq fichiers auparavant non suivis sont maintenant versionnés. Six migrations de récupération/sécurité supplémentaires portent le total à **145**. Les sept RPC ont été récupérées depuis leurs définitions réelles, puis sécurisées. Les autres contrats de support nécessaires aux consumers existants ont été réintégrés depuis le catalogue observé. Le ledger, ses adapters et handlers, les tests et le framework d’évaluation sont commités.

**VERIFIED REMOTE** : neuf migrations ont été appliquées et relues ; le catalogue des migrations passe de 175 à 184. Les quatre handlers V6 ont été déployés. Leurs **32 occurrences de fichiers** relues sont identiques au checkout commité. Leurs quatre configurations `verify_jwt=true` sont vérifiées. Les 17 crons conservent leurs noms, horaires et états actifs ; leurs commandes utilisent désormais un dispatcher configuré, sans JWT ni projet codé en dur dans les commandes effectives.

**UNKNOWN** : pertinence sémantique réelle, calibration, qualité statistique, E2E complet produit/Ask Tohu, conformité de tous les consumers à une autorité V6 exclusive. Ces points appartiennent aux gates suivants et ne sont pas déclarés acquis.

## Architecture avant/après

Avant : contrats distants non reproductibles, RPC privilégiées exposées, writers contact-only, serveur divergent du noyau testé.

Après : fondation canonique partagée navigateur/Edge, ledger bitemporel par `(organization_id, collaborator_user_id, contact_id)`, contrôle des preuves admissibles, sorties séparant score/reliability/coverage, erreurs explicites et observations candidates. Le mode reste `foundation_shadow` ; `V6_PRODUCT_AUTHORITY=false`. Les contrats de compatibilité et les responsabilités Legacy restent présents jusqu’aux phases 4 et 5.

Les nouvelles RPC ne prétendent pas rendre admissibles les 386 anciens markers ni réparer les 447 anciens snapshots. Ils restent exclus du ledger de fondation tant que provenance et qualité ne sont pas établies.

## Fichiers modifiés

- Noyau `supabase/functions/_shared/scoring-v6/`, réexports `src/services/scoring/`, quatre handlers V6, configuration Edge et TypeScript.
- `supabase/migrations/`, six suites SQL `supabase/tests/v6_*.sql`, script `scripts/v6-rebuild-isolated.py`.
- `evaluation/relational-intelligence/` : gabarits exclus des métriques humaines, validation d’annotations A/B, arbitrage, anti-fuite development/holdout et métriques par marker.
- Rapports et preuves `docs/audits/` ; runbook `V6_RECONSTRUCTION_RUNBOOK.md`.

Les modifications UI préexistantes et l’évolution de `behavior-analysis.ts` restent conservées à part dans le working tree. Elles ne sont pas assimilées à du code déployé par cette remédiation.

## Migrations et commits

| Commit | Contenu |
|---|---|
| `89defea` | Sept RPC récupérées, droits de caller, brain et réconciliation |
| `e14f3ab` | Contrats de support déployés ; versionnement des deux migrations antérieures de mémoire/profils |
| `964da6a` | Isolation Storage des documents par organisation |
| `891ca29` | Fondation, trois migrations préexistantes, tests et framework d’évaluation |
| `c614770` | Correctifs Slack préexistants, isolés dans leur propre commit |
| `031f651` | Reconstruction des 17 jobs avec configuration externe |
| `2e832fc` | Protection des privilèges de profil, fermeture des routines privilégiées et configurations JWT explicites |

La migration préexistante `20260917100000` a reçu une correction ciblée : deux snapshots différents avec la même identité de calcul déclenchent `IMMUTABLE_SNAPSHOT_CONFLICT`. Son empreinte diffère donc du manifeste historique ; aucun des cinq fichiers n’a été supprimé. Les autres définitions historiques ne sont pas réécrites pour masquer le drift.

## Tests

**VERIFIED LOCAL — depuis Git :**

- PostgreSQL Supabase 17.6 sans réseau ni exécution de cron : **145/145 migrations applicatives et 6/6 suites SQL réussies** ; schéma géré Storage initialisé depuis ses **67 migrations officielles**. Voir `v6-phase1-rebuild-git-validation.json`.
- Archive propre du commit `c614770` : **412/412 tests, 38 fichiers**, TypeScript frontend et Edge réussis. Voir `v6-phase1-git-code-validation.json`. Les changements suivants portent sur SQL/configuration/documentation, pas sur le noyau TypeScript testé.
- Working tree : 414/414 ; les deux tests UI supplémentaires ne sont pas présentés comme commités. Le premier essai depuis Git avait révélé huit échecs Slack : corrigés par versionnement séparé du correctif et de ses tests existants.
- Tests SQL : propriétaire, autre membre sans partage, autre organisation, anonyme/service ; révisions immuables, deux collaborateurs pour un contact, réessais idempotents, snapshots conflictuels, uploads/déplacements Storage inter-organisations, reconstruction des crons et élévation de privilèges.

Les tests PostgreSQL remplacent les suppositions sur l’exécution des migrations et les ACL. Les tests avec mocks restent des tests de code ; ils ne sont jamais présentés comme des preuves de production.

## Métriques

**VERIFIED REMOTE — essai borné :** 100 messages importés par organisation, soit **200 révisions / 83 dyades** ; zéro incohérence d’organisation/contact ou d’appartenance collaborateur détectée. **25 snapshots**, tous `score=null`, `reliability=null`, `status=insufficient_evidence` ; zéro marker accepté dans ce ledger. La qualité des 200 événements reste `unknown`, sans conversion en 1. Aucun score artificiel n’est produit.

Une exécution de classification a enregistré `technical_error / SOURCE_TEXT_UNAVAILABLE`. Elle n’a pas été changée en `NO_MARKER`. Ce résultat prouve la gestion explicite d’une source indisponible, pas la compréhension relationnelle. Les 15 cas synthétiques restent exclus du Gold Dataset humain.

## Cas réels vérifiés

- API Management en lecture (`supabase_read_only_user`) et administration (`postgres`) ; MCP métadonnées effectif. MCP `execute_sql` reste `Insufficient scope`, explicitement remplacé par l’API autorisée pour SQL.
- Test `account_brain` en lecture seule sous l’identité d’un membre : **217/217 comptes visibles lus avec succès**, sans export de contenu métier. Matrice d’isolation complète exercée localement avec rôles PostgreSQL réels.
- Requêtes anonymes aux quatre handlers : 401. L’authentification cron vérifiée permet ingestion/détection/calcul. Un JWT legacy différent du credential configuré reste refusé par le handler ; les trois crons V6 transmettent `x-cron-secret`, chemin effectivement testé.
- 17 commandes de cron relues ; horaires et états inchangés. Aucun déclenchement manuel des jobs d’envoi d’emails.

## Problèmes découverts

Sept RPC manquantes dans Git ; tables, colonnes et contrats de support absents du replay ; neuf jobs seulement reconstruits initialement ; collisions de snapshots ignorées ; Storage sans frontière d’organisation ; contrôle administrateur fondé sur un champ de profil modifiable ; maintenance accessible aux clients ; décalage des fixtures Auth locales et checkpoints Slack.

## Corrections

Les RPC de compatibilité et `account_brain` appliquent les droits de l’appelant ; writers et maintenance sont réservés au service. Les readers de markers vérifient la visibilité. Les documents Storage sont limités au premier composant de chemin correspondant à une organisation du membre.

L’autorité administrateur utilise `super_admins`, jamais un champ de présentation. Les colonnes de privilèges de profil ne sont plus insérables/modifiables par le client ; les éditions ordinaires du profil restent possibles. Les anciens endpoints de partage retirés du Git sont fermés aux clients s’ils existent encore à distance. Aucun `SECURITY DEFINER` public n’est exécutable par `anon` après correction.

## Risques restants

L’advisor conserve des avertissements : 48 routines DEFINER accessibles à des utilisateurs authentifiés (nécessitant leurs guards, pas automatiquement des failles), `pg_net` dans public, protection des mots de passe compromis désactivée. Les 13 tables avec RLS sans policy sont volontairement réservées au serveur. Voir `v6-phase1-final-security-advisors.json` et [les règles de l’advisor](https://supabase.com/docs/guides/database/database-linter). La revue générale pré-lancement reste requise en Phase 6 ; ce rapport ne déclare pas Tohu prêt pour des clients réels.

Les sources de texte manquent dans le chemin message importé : aucune performance sémantique ne peut en être déduite. La migration de tous les consumers et la suppression de Legacy restent à faire.

## Dette restante

Gold Dataset réel avec annotations humaines indépendantes et arbitrage ; audit de taxonomie et expériences mesurées ; moteur complet et calibration ; migration des consumers ; suppression Legacy ; E2E/holdout final. Les deux comptes de fondateurs ne sont pas un dataset statistique.

## État distant

Pièces : `v6-phase1-security-deployment.json`, `v6-phase1-foundation-deployment.json`, `v6-phase1-edge-deployment.json`, `v6-phase1-edge-readback-comparison.json`, `v6-phase1-remote-shadow-smoke.json`, `v6-phase1-foundation-remote-integrity.json`, `v6-phase1-cron-deployment.json`, `v6-phase1-final-security-deployment.json`.

Aucune donnée source supprimée, aucun reset, aucune suppression Legacy. Dernier comptage : 543 contacts, 277 meetings, 4 950 messages (les synchronisations existantes continuent). Les comptes de données historiques de l’inspection ne sont pas un snapshot figé du serveur actuel.

## GO / NO GO

**YES** : les fondations nécessaires à V6 sont maintenant reconstructibles depuis Git sur une base Supabase vide, avec ses schémas gérés et les secrets externes décrits dans le runbook. Les migrations, contrats, droits, workers et jobs nécessaires sont versionnés et le replay est exécuté, pas supposé.

**GO Phase 2.** Déterminisme, dyades, absence de score sans preuve, temporalité, qualité explicite, parité du noyau, sécurité critique démontrée et framework humain sont vérifiés à la portée Phase 1. Ce YES n’est ni une copie de toutes les données de test, ni une équivalence bit à bit avec tous les objets historiques distants, ni une validation du produit final.
