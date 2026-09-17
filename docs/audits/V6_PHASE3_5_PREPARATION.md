# V6 — clôture des Phases 3 à 5

Date : 17 septembre 2026  
Statut : **DONE**

## Phase 3 — cerveau canonique

La fondation V6 est l'unique ledger relationnel. `person_brain` et `account_brain` exposent les états dyade, compte, fiabilité, couverture, preuves, historique, changements, causes et versions. Les deux fonctions sont `SECURITY INVOKER`; l'isolation repose sur les RLS et les contrôles d'organisation/contact/compte.

Le calcul compte ne publie que des dyades admissibles. Une fiabilité ambre n'est pas présentée comme autoritaire. La dynamique reste inconnue sans ledger canonique d'engagements. Aucun seuil, poids ou marker n'a été recalibré sans Gold humain.

Verdict : **GO Phase 3**.

## Phase 4 — consommateurs

La Home, les listes Comptes et Personnes, les fiches Compte et Personne, les briefs et le digest consomment les RPC V6 canoniques. Les déclenchements navigateur de l'ancien batch ont été retirés. Les recommandations et synthèses interprétatives restent suspendues jusqu'à la calibration humaine.

L'inventaire `v6-phase4-5-consumer-inventory.json` distingue runtime, tests et migrations historiques. Son gate constate `active_legacy_occurrences: 0`.

Verdict : **GO Phase 4**.

## Phase 5 — retrait Legacy

La migration `20260917180531_retire_legacy_relational_engine.sql` :

- désactive le cron de l'ancien `score-batch` ;
- retire les sept RPC de compatibilité et les lecteurs de markers remplacés ;
- retire les tables dérivées de scores, snapshots, recommandations et lectures stratégiques Legacy ;
- retire `scoring.marker_event`, `scoring.score_snapshot` et les colonnes relationnelles Legacy de `cognitive_profiles` ;
- nettoie les caches de score dans `companies.public_context`.

Les fonctions Edge `score-batch` et `account-strategic-reading` ont été supprimées localement et à distance. Les sources emails, réunions, transcripts, contacts, parcours, mémoires, faits manuels et provenances sont conservés.

La vérification distante confirme l'absence des neuf tables/objets Legacy contrôlés, l'absence des deux fonctions Edge retirées, et un seul cron de scoring actif : `tohu-bohu-score-v6-account`.

Verdict : **GO Phase 5**.
