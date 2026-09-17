# V6 — journal global d’exécution

## Mandat

17 septembre 2026 : exécution séquentielle des Phases 1 à 6 autorisée, corrections autonomes entre les gates. Aucun passage au gate suivant sans preuves. Les sources utiles doivent être conservées. Les données dérivées Legacy de test pourront être retirées seulement après remplacement de leurs responsabilités.

## État

| Phase | État | Verdict | Preuves / changements |
|---|---|---|---|
| Phase 0 | DONE — audit livré | Audit terminé, moteur non validé | `PHASE_0_MOTEUR_RELATIONNEL_V6.md` |
| Phase 1 | DONE — 17 septembre 2026 | **GO** | État distant vérifié et remédié ; reconstruction Git isolée 145/145 migrations + 67 Storage + 6/6 tests SQL ; 414/414 tests applicatifs ; sécurité critique corrigée |
| Phase 2 | BLOCKED — 17 septembre 2026 | **NO GO** | 23 candidats réels privés préparés ; 0 cas revu, doublement annoté et arbitré ; intervention humaine externe requise |
| Phase 3 | NOT STARTED | Aucun | Dépend de Phase 2 et de preuves humaines |
| Phase 4 | NOT STARTED | Aucun | Contrats canoniques à valider en Phase 3 |
| Phase 5 | NOT STARTED | Aucun | Aucune suppression Legacy autorisée avant remplacement démontré |
| Phase 6 | NOT STARTED | NOT READY | Aucun résultat E2E/holdout final |

## Phase 2 — gate bloqué

- Audit complet des 34 entrées du registre livré dans `V6_MARKER_TAXONOMY_AUDIT.md`; aucune modification opportuniste de `reg-v6.0`.
- Harness étendu aux faits, engagements, rôles, direction et `dataset_version`; revue de confidentialité obligatoire.
- État distant read-only : 23 verbatims datés sur 16 contacts/2 organisations, 80 résumés LLM exclus du Gold strict, 1 transcript.
- 23 candidats pseudonymisés préparés localement : 21 development, 2 holdout, tous non revus et non annotés ; holdout à enrichir avant validation.
- Tests : 416/416 et TypeScript verts. Métriques humaines : non calculables, effectif 0.
- **NO GO Phase 2** : deux annotations humaines indépendantes et un arbitrage ne peuvent pas être produits honnêtement par l'agent. Phase 3 reste interdite.

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
