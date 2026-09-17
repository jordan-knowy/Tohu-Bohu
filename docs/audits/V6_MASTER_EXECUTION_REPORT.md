# V6 — journal global d’exécution

## Mandat

17 septembre 2026 : exécution séquentielle des Phases 1 à 6 autorisée, corrections autonomes entre les gates. Aucun passage au gate suivant sans preuves. Les sources utiles doivent être conservées. Les données dérivées Legacy de test pourront être retirées seulement après remplacement de leurs responsabilités.

## État

| Phase | État | Verdict | Preuves / changements |
|---|---|---|---|
| Phase 0 | DONE — audit livré | Audit terminé, moteur non validé | `PHASE_0_MOTEUR_RELATIONNEL_V6.md` |
| Phase 1 | DONE — 17 septembre 2026 | **GO** | État distant vérifié et remédié ; reconstruction Git isolée 145/145 migrations + 67 Storage + 6/6 tests SQL ; 414/414 tests applicatifs ; sécurité critique corrigée |
| Phase 2 | DONE TECHNIQUE — 17 septembre 2026 | **GO WITH DEFERRED HUMAN CALIBRATION** | Architecture conservative, 35 cas privacy-reviewed, benchmark A/B reporté sans métrique inventée |
| Phase 3 | DONE — 17 septembre 2026 | **GO** | Fondation V6, snapshots compte, causalité versionnée et brains canoniques uniques |
| Phase 4 | DONE — 17 septembre 2026 | **GO** | Home, listes, fiches, briefs et digest branchés sur V6 ; autorité produit activée |
| Phase 5 | DONE — 17 septembre 2026 | **GO** | Autorité Legacy active = 0 ; fonctions, crons, RPC, tables et colonnes dérivées retirés |
| Phase 6 | DONE TECHNIQUE — 17 septembre 2026 | **GO WITH DEFERRED HUMAN CALIBRATION** | Rebuild Git 148/148, 67 Storage, 6/6 SQL ; build et 408 tests ; pipeline distant 83 dyades/0 erreur ; observabilité active |

## Phase 2 — calibration humaine reportée

- Audit complet des 34 entrées du registre livré dans `V6_MARKER_TAXONOMY_AUDIT.md`; aucune modification opportuniste de `reg-v6.0`.
- Harness étendu aux faits, engagements, rôles, direction et `dataset_version`; revue de confidentialité obligatoire.
- État distant read-only : 23 verbatims datés sur 16 contacts/2 organisations, 80 résumés LLM exclus du Gold strict, 1 transcript.
- Corpus V2 préparé sans consulter le modèle : 35 cas sur 25 groupes, dont 27 development et 8 holdout ; 23 ponctuels et 12 séquentiels. Support compte/métier absent, documenté `insufficient_support`.
- Interface locale complète : confidentialité/annotabilité, A/B isolés et randomisés, gel, divergences automatiques, arbitrage ciblé et enveloppe Gold versionnée.
- Préparation non bloquante Phases 3–5 : inventaire reproductible de 282 références canoniques/Legacy et ordre de retrait documenté ; aucune décision dépendante du Gold appliquée.
- Tests : 417/417 et TypeScript verts. Métriques humaines : non calculables, effectif 0.
- **GO WITH DEFERRED HUMAN CALIBRATION** : la validation sémantique humaine reste `PENDING`; les sorties LLM sont candidates et sans score direct. La décision produit autorise la poursuite technique sous garde-fous conservateurs.

## Phases 3 à 6 — clôture technique

- `person_brain` et `account_brain` sont les contrats UI uniques. Ils lisent les snapshots V6 sous les RLS de l'appelant et exposent explicitement les données insuffisantes.
- La Home, les listes Comptes/Personnes, les fiches, les briefs et le digest ne lisent plus les snapshots, scores ou recommandations Legacy. L'inventaire reproductible trouve **0 occurrence Legacy dans le runtime actif**.
- Les fonctions Edge `score-batch` et `account-strategic-reading`, leur cron, les sept RPC de compatibilité, les tables de scores/recommandations Legacy et les colonnes relationnelles de `cognitive_profiles` ont été retirés. Les emails, réunions, transcripts, contacts, parcours, mémoires et provenances sont conservés.
- La reconstruction du commit Git applique **148/148 migrations**, **67/67 migrations Storage** et **6/6 suites SQL**. Le build production et **408/408 tests applicatifs** passent.
- Le runner V6 déployé a traité **83 dyades** en quatre lots et **0 erreur compte**. Les quatre exécutions sont enregistrées avec durées, volumes et versions ; durée distante observée : 3,7 à 8,5 s par lot de 25 maximum.
- L'état distant contient 166 snapshots dyadiques et 47 snapshots compte, tous `insufficient_evidence`. Il ne contient encore aucun marker canonique. Cette abstention est attendue tant que la calibration humaine est reportée ; aucun score de secours n'est publié.
- Preuves finales : `V6_PHASE3_5_PREPARATION.md`, `PHASE_6_VALIDATION.md`, `v6-phase4-5-consumer-inventory.json`, `v6-phase6-rebuild-validation.json` et `v6-phase6-remote-verification.json`.
- Le backend Supabase et le frontend sont publiés. Le projet Netlify `tohu-bohu`, lié au dépôt GitHub `jordan-knowy/Tohu-Bohu`, sert la production sur `https://tohu.co` ; la page publique et les règles de redirection ont été vérifiées après le push sur `main`.

## Replay des sources et diagnostic des scores — 17 septembre 2026

À la demande du produit, un replay distant des messages a été exécuté sans supprimer les sources. Les **4 964 messages** ont été importés dans le ledger V6, couvrant **347 dyades**. Le détecteur déterministe a produit **492 révisions de marker**, puis le calcul a confirmé **0 score de dyade** et **0 score de compte publiables**. La première passe d'import avait qualifié à tort la présence de métadonnées de message comme identité et complétude vérifiées. Cette qualification a été corrigée par des révisions immuables ; les 492 markers provisoires ont été superseded, puis les **347 dyades** et **171 comptes** recalculés. Les derniers snapshots affichables restent tous sans score.

Les causes vérifiées sont distinctes de la calibration humaine : les messages ne conservent pas leur corps (`analyzed_without_body_storage`), les événements du ledger ont maintenant `identity=unknown` et `completeness=unknown`, aucune révision de rôle ni aucun rôle manuel de compte n'existe, et les quatre essais du classificateur ont échoué avec `SOURCE_TEXT_UNAVAILABLE`. Les **282 réunions** et l'unique transcript n'ont pas été promus en preuves dyadiques : les 663 statuts de réponse aux invitations sont `needsAction`, et aucun participant du transcript n'est lié à un contact. Un statut `confirmed` de réunion ne prouve pas sa tenue.

L'import des nouveaux messages est désormais planifié toutes les dix minutes, avec un curseur stable `(created_at,id)` et des lots de 500. La détection, la classification et le calcul restent planifiés toutes les six heures ; ils ne peuvent publier un score que lorsque les critères V6 d'identité, de complétude, de rôle, de couverture, de fiabilité, d'axes et de preuves indépendantes sont réellement satisfaits. **Aucune date d'apparition d'une météo chiffrée ne peut donc être promise.** L'acceptation produit de la baseline V6 ne constitue pas une annotation humaine effectuée ni une preuve manquante.

Validation : replay isolé **150/150 migrations**, **67/67 Storage**, **6/6 suites SQL**, **408/408 tests applicatifs**, TypeScript et build de production réussis. Le détail est dans `V6_REPLAY_SCORES_2026_09_17.md`.

## Reprise — 17 septembre 2026

- HEAD de départ : `f34a7f5b216fa708c128f75ce441093b808d9ed1` ; 32 fichiers suivis modifiés et fichiers non suivis préexistants. Aucun de ces travaux n’est écrasé.
- Les 139 migrations initiales, dont 5 non suivies, restent conservées. Les empreintes de l’inspection précédente servent de référence.
- MCP métadonnées fonctionnel, MCP SQL toujours `Insufficient scope`. La session précédente a utilisé l’API Management en lecture seule avec succès ; les pièces SQL réelles sont conservées dans `docs/audits`.
- Docker Desktop était arrêté ; démarré pour permettre une base Supabase locale isolée. La validation utilise un nouveau conteneur sans réseau, avec exécution des crons désactivée, afin que le replay de SQL historique ne puisse pas appeler le projet distant.
- Phase 1 validée sur le commit `b341d881deeab19ce498ddcdd5ce6a31adac54a1` : 414/414 tests Vitest et vérification TypeScript réussis. Le rejeu Git isolé, sans réseau et avec les crons désactivés, applique 67 migrations Storage, 145/145 migrations applicatives et 6/6 tests SQL.
- Les RPC manquantes, fondations V6, ACL/RLS, isolation Storage, sécurité des profils, configuration des crons et sources Edge déployées ont été réconciliées puis relues. Les rapports `PHASE_1_ETAT_DISTANT.md` et `PHASE_1_REMEDIATION.md` portent les preuves et limites exactes.
- Verdict de reconstruction depuis Git : **YES** pour l'architecture nécessaire au moteur V6 au terme de Phase 1. Verdict : **GO Phase 2**.
- Phase 2 démarre sans modifier les scores ni prétendre à une validation sémantique : le registre doit être audité et un Gold Dataset humain à double annotation doit fournir les preuves du gate.

## Gate Phase 1 — clôturé

1. Reconstruction réelle depuis Git : **PASS**.
2. RPC, ACL/RLS, guards et sources de markers : **PASS dans le périmètre documenté**.
3. Tests multi-organisations, identité dyadique, temporalité, absence de neutralité artificielle et parité : **PASS**.
4. Fondation et configurations reproductibles : **PASS**.

Le rapport d’inspection `PHASE_1_ETAT_DISTANT.md` conserve explicitement l'état antérieur aux corrections et le distingue de l'état remédié.
