# Phase 6 — validation finale V6

Date : 17 septembre 2026  
Verdict : **GO WITH DEFERRED HUMAN CALIBRATION**

## Reconstruction et tests

- reconstruction depuis le commit Git : **148/148 migrations applicatives** ;
- schéma Storage : **67/67 migrations** ;
- sécurité et contrats SQL : **6/6 suites** ;
- build frontend production : **PASS** ;
- TypeScript : **PASS** ;
- Vitest : **408/408 tests**, 38 fichiers ;
- inventaire runtime : **0 autorité Legacy active**.

## Sécurité

Les tables `foundation_dyad`, `foundation_revision`, `foundation_snapshot`, `account_snapshot` et `pipeline_run` ont RLS activé. Les brains et RPC de portefeuille utilisent les droits de l'appelant. Les RPC d'écriture et d'observabilité sont réservées au `service_role`. Les suites SQL couvrent notamment l'isolation inter-organisations, les ACL des routines, Storage et le retrait des objets Legacy.

## Exécution distante

Le runner `score-batch-account-v6` version 7 a traité le backlog en quatre lots : **83 dyades**, **47 calculs compte**, **0 erreur**. Les exécutions ont duré de **3 671 ms à 8 540 ms**, avec une moyenne de **6 526 ms**. Le cron canonique reste actif toutes les six heures.

L'état observé contient 166 snapshots dyadiques et 47 snapshots compte. Tous sont `insufficient_evidence`, avec 0 doublon de dyade, 0 doublon de révision marker, 0 marker inconnu et 0 snapshot publié sans preuve admissible. Aucun marker canonique n'existe encore ; le produit s'abstient donc au lieu d'afficher un score de secours.

## Observabilité

`scoring.pipeline_run` enregistre le statut, la durée, les volumes, les versions et une erreur bornée, sans contenu d'email, transcript ou preuve. Les quatre exécutions distantes sont `succeeded`. `v6_pipeline_health` fournit un résumé réservé au service.

## Limite assumée

La calibration humaine A/B, l'arbitrage, le Gold v1 et les métriques TP/FP/FN, précision, rappel et F1 restent différés. Aucune métrique n'est inventée. Les recommandations et interprétations dépendantes du Gold restent suspendues.

Le moteur V6 est techniquement unique, reconstructible, déployé et observable. Son activation sémantique avancée reste conditionnée à la calibration humaine.
