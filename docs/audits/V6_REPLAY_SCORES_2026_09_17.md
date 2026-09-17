# V6 — replay des sources et publication des scores

Date : 17 septembre 2026. Projet : `bgmtzwfafcgjklgygvtx`.

## Résultat distant vérifié

| Mesure | Résultat |
|---|---:|
| Messages sources | 4 964 |
| Messages importés dans le ledger V6 | 4 964 |
| Dyades V6 | 347 |
| Derniers snapshots dyadiques | 347 |
| Derniers snapshots compte | 171 |
| Scores dyadiques publiables | 0 |
| Scores compte publiables | 0 |
| Rôles déclarés dans le ledger | 0 |
| Rôles manuels actifs dans `account_contact_roles` | 0 |
| Classifications en erreur `SOURCE_TEXT_UNAVAILABLE` | 4 |

L'import historique, la détection et le calcul ont été exécutés intégralement, page par page. La détection initiale a produit 492 markers, mais elle reposait sur une assimilation incorrecte entre présence de métadonnées et preuve de vérification d'identité et de complétude. Cette erreur a été corrigée par de nouvelles révisions des événements et de la qualité, sans suppression des sources. Une deuxième passe du détecteur a superseded les 492 markers. Les derniers états de tous les événements et qualités importés sont `unknown/unknown` ; le dernier état des 492 markers est `superseded`. Le recalcul final a traité les 347 dyades sans erreur de compte et n'a publié aucun score.

Les 347 derniers snapshots dyadiques portent tous les raisons `IDENTITY_NOT_VERIFIED`, `INCOMPLETE_DATA`, `UNKNOWN_ROLE`, `UNKNOWN_OR_ZERO_COVERAGE`, `INSUFFICIENT_RELIABILITY`, `INSUFFICIENT_INDEPENDENT_EVIDENCE`, `UNOBSERVED_AXES` et `COLD_START`. Les 171 derniers snapshots compte sont `insufficient_evidence`. Un « compte traité » par le runner désigne un snapshot écrit ; cela ne signifie pas qu'un score numérique a été produit.

## Sources non promues en preuves

- Les 4 964 messages ont `from`, `to`, `thread_id`, `direction` et `sent_at`, mais leur corps n'est pas stocké (`analyzed_without_body_storage`). La correspondance d'adresse peut aider à vérifier une partie des acteurs ; elle ne prouve ni la complétude des échanges ni les cinq axes relationnels.
- Les 282 réunions comprennent 113 réunions passées, mais les 663 réponses de participants sont `needsAction`. Une réunion `confirmed` ou passée n'est pas une preuve de participation effective.
- Le transcript unique a un texte et un consentement `granted`, mais aucun de ses 15 participants n'est lié à un contact. Il ne peut pas être attribué à une dyade sans résolution d'identité.
- Les 21 `person_memory_entries` avec extrait source restent disponibles pour un raccordement sémantique ultérieur ; le classificateur V6 actuel ne les lit pas depuis le ledger et ses quatre exécutions sont `technical_error: SOURCE_TEXT_UNAVAILABLE`. Aucun résultat Gold ou score n'en est déduit.

## Automatisation effective et limites

Le nouveau job `tohu-bohu-v6-ingest-events` est actif à `5-55/10 * * * *`. Il charge au plus 500 nouveaux messages par invocation, avec un curseur ordonné `(created_at,id)` qui évite de relire en boucle la première page. Les jobs de détection, classification et scoring restent actifs toutes les six heures. L'import et le recalcul peuvent donc se poursuivre automatiquement, mais un score ne peut apparaître que lorsque la preuve V6 requise existe effectivement. Le job d'ingestion n'importe actuellement que `communication_messages` ; il ne transforme ni les réunions ni les transcripts en preuves dyadiques. La classification sémantique n'est pas opérationnelle sur des événements sans texte. Aucune date d'apparition des scores n'est connue.

L'acceptation produit de la baseline et la dispense de calibration humaine ne changent pas ces conditions d'admissibilité. Le résultat reste **0 score publiable**, sans fallback Legacy ni score inventé.

## Validation

Reconstruction locale isolée : **150/150 migrations applicatives**, **67/67 Storage**, **6/6 suites SQL**. **408/408 tests Vitest**, vérification TypeScript et build de production réussis. Les deux nouvelles migrations et la version corrigée de `v6-ingest-events` ont été appliquées/déployées au projet distant ; la fonction a été relue en invoquant le curseur, qui a répondu `imported: 0` après l'import complet.
