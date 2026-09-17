# V6 — journal global d’exécution

## Mandat

17 septembre 2026 : exécution séquentielle des Phases 1 à 6 autorisée, corrections autonomes entre les gates. Aucun passage au gate suivant sans preuves. Les sources utiles doivent être conservées. Les données dérivées Legacy de test pourront être retirées seulement après remplacement de leurs responsabilités.

## État

| Phase | État | Verdict | Preuves / changements |
|---|---|---|---|
| Phase 0 | DONE — audit livré | Audit terminé, moteur non validé | `PHASE_0_MOTEUR_RELATIONNEL_V6.md` |
| Phase 1 | IN PROGRESS — remédiation | NO GO | Inspection distante terminée ; 414 tests verts ; reconstruction et sécurité à corriger |
| Phase 2 | NOT STARTED | Aucun | Aucun GO Phase 1 |
| Phase 3 | NOT STARTED | Aucun | Dépend de Phase 2 et de preuves humaines |
| Phase 4 | NOT STARTED | Aucun | Contrats canoniques à valider en Phase 3 |
| Phase 5 | NOT STARTED | Aucun | Aucune suppression Legacy autorisée avant remplacement démontré |
| Phase 6 | NOT STARTED | NOT READY | Aucun résultat E2E/holdout final |

## Reprise — 17 septembre 2026

- HEAD de départ : `f34a7f5b216fa708c128f75ce441093b808d9ed1` ; 32 fichiers suivis modifiés et fichiers non suivis préexistants. Aucun de ces travaux n’est écrasé.
- Les 139 migrations initiales, dont 5 non suivies, restent conservées. Les empreintes de l’inspection précédente servent de référence.
- MCP métadonnées fonctionnel, MCP SQL toujours `Insufficient scope`. La session précédente a utilisé l’API Management en lecture seule avec succès ; les pièces SQL réelles sont conservées dans `docs/audits`.
- Docker Desktop était arrêté ; démarré pour permettre une base Supabase locale isolée. La validation utilise un nouveau conteneur sans réseau, avec exécution des crons désactivée, afin que le replay de SQL historique ne puisse pas appeler le projet distant.
- Dernière phase validée : **Phase 0 (audit seulement)**. Derniers tests disponibles : 414/414, TypeScript frontend et foundation verts. Aucun nouveau commit ni changement distant à cette étape.

## Bloqueurs de gate Phase 1 à traiter

1. Reconstruction réelle depuis Git, réconciliation des migrations manquantes et des versions divergentes.
2. RPC privilégiées sans autorisation et ACL ouvertes, guards de `account_brain`, réconciliation et sources de markers.
3. Tests SQL multi-organisations, rôles et identité dyadique ; parité et admissibilité temporelle.
4. Versionnement cohérent de la fondation, configurations et preuves de validation.

Le rapport d’inspection `PHASE_1_ETAT_DISTANT.md` est conservé comme état antérieur aux corrections. Les remédiations seront rapportées séparément.
