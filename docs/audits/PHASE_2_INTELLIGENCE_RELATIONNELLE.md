# Phase 2 — intelligence relationnelle et LLM

Date : 17 septembre 2026  
Statut : **bloquée sur validation humaine externe**  
Verdict : **NO GO Phase 2**

## Résumé

La Phase 1 est validée et la Phase 2 a commencé. Le registre complet a été audité concept par concept, le classificateur multi-observations et ses garde-fous ont été relus, le harness Gold a été renforcé et 23 extraits réels verbatim, datés et pseudonymisés ont été préparés dans un espace privé. Aucun résultat de pertinence n'est inventé : zéro cas possède aujourd'hui deux annotations humaines indépendantes et un arbitrage. Le gate exige précisément cette preuve ; il reste donc **NO GO**.

Ce blocage ne peut pas être corrigé par un agent logiciel sans falsifier le caractère humain et indépendant du Gold Dataset. Phase 3 n'est pas commencée.

## Travail réalisé

- Audit des 34 entrées C01–C05, S01–S08, E01–E05, R01–R02, A01–A02, K01–K09 et X01–X03 : utilité, définition, temporalité, impact, preuve et risque de faux positif.
- Maintien de `reg-v6.0` : aucune création, fusion, suppression ou recalibration sans résultat humain.
- Proposition documentée de reclasser ultérieurement K09 en état de couverture, X01 en qualité de données, X02 en état relationnel et X03 en fait/engagement. Cette proposition n'est pas appliquée.
- Vérification de la classification `0..N` : elle conserve faits, markers, engagements et rôles séparés, les contradictions, les conditions, la volontarité, l'identité et les citations exactes. Toutes les sorties restent candidates, sans score.
- Extension du harness aux métriques séparées des faits, engagements, rôles et direction, en plus des TP/FP/FN, précision, rappel et F1 par marker.
- Ajout de `dataset_version` au contrat d'expérience et refus du mélange de versions.
- Exclusion automatique des cas réels qui n'ont pas `privacy_reviewed: true` ; contenus et paquets privés ignorés par Git.
- Inventaire distant read-only des sources et création locale de 23 candidats pseudonymisés. Le script n'affiche jamais leur contenu.
- Guide d'annotation A/B et d'arbitrage, avec exigences renforcées pour S07 et K06.

## Architecture avant / après

Avant, le harness mesurait uniquement les markers et distinguait déjà erreurs techniques et abstentions. Il exigeait A/B et arbitrage, mais ne bloquait pas explicitement un cas humain non revu pour la confidentialité et ne versionnait pas le dataset dans chaque prédiction.

Après, le pipeline d'évaluation sépare markers, faits, engagements, rôles et direction ; exige une version de dataset ; conserve les désaccords ; protège le holdout par `group_id` ; exclut les cas synthétiques et les cas humains non revus. L'architecture de production et les scores sont inchangés.

## Fichiers modifiés

- `docs/audits/V6_MARKER_TAXONOMY_AUDIT.md`
- `docs/audits/v6-phase2-source-inventory.json`
- `evaluation/relational-intelligence/harness.ts`
- `evaluation/relational-intelligence/harness.test.ts`
- `evaluation/relational-intelligence/README.md`
- `evaluation/relational-intelligence/ANNOTATION_GUIDE.md`
- `scripts/v6-export-gold-candidates.py`
- `.gitignore`
- `docs/audits/V6_MASTER_EXECUTION_REPORT.md`

Le fichier réel `evaluation/relational-intelligence/private/candidates.v1.json` contient les 23 candidats, est en mode `0600` et n'est pas versionné.

## Migrations

Aucune migration. Aucune écriture distante. Aucun déploiement Edge, cron ou changement de configuration pendant cette étape de Phase 2.

## Tests

- Vitest : **416/416 réussis**, 38 fichiers.
- TypeScript frontend : **PASS**.
- Harness sur les 15 gabarits synthétiques : `evaluated: 0`, comportement attendu.
- Exporteur Python : compilation `py_compile` **PASS**.
- `git diff --check` : **PASS**.
- Référence Phase 1 au commit `b341d881deeab19ce498ddcdd5ce6a31adac54a1` : 145/145 migrations, 67 migrations Storage, 6/6 tests SQL sur base isolée sans réseau.

## Métriques

| Mesure | Résultat actuel |
|---|---:|
| Cas Gold humains revus | 0 |
| Cas avec annotation A | 0 |
| Cas avec annotation B indépendante | 0 |
| Cas arbitrés | 0 |
| Cas évaluables development | 0 |
| Cas évaluables holdout | 0 |
| Précision / rappel / F1 | non calculables |
| Faux positifs S07/K06 | non calculables |
| Abstention / erreur technique sur Gold | non calculables |

Les valeurs `null` produites par le harness sont la représentation correcte de l'absence d'effectif ; elles ne sont pas remplacées par zéro.

## Cas réels vérifiés

L'inventaire read-only du projet `bgmtzwfafcgjklgygvtx` trouve :

- 23 `person_memory_entries.source_excerpt` non vides, tous datés, couvrant 16 contacts et les 2 organisations ;
- 80 `person_key_moments.summary`, couvrant 20 contacts et 2 organisations ;
- 1 transcript non vide dans 1 organisation.

Les 23 extraits verbatim sont les seuls candidats exportés. Les 80 résumés sont des dérivations LLM et ne servent pas de vérité Gold. Aucun contenu source n'est inclus dans les rapports Git. Les candidats n'ont pas encore le contexte avant/après requis pour une annotation fiable ; la revue humaine devra soit compléter ce contexte depuis les sources autorisées, soit marquer les champs indéterminables.

## Problèmes découverts

1. Aucun Gold Dataset humain n'existe encore.
2. Les 23 candidats sont un petit corpus de deux comptes fondateurs, insuffisant pour démontrer la généralisation.
3. Le registre sémantique exécutable couvre seulement C01, C05, S03, S06, S07, S08 et E01–E04 ; les autres concepts exigent des détecteurs de séquence, baseline ou sources métier.
4. Les extraits isolés ne suffisent pas toujours à déterminer cible, rôle, spontanéité, condition ou contradiction.
5. `person_key_moments.summary` n'est pas un verbatim et ne doit pas valider les markers critiques.
6. La pertinence des seuils, poids et caps n'est pas démontrée ; aucune calibration n'est autorisée.

## Corrections

Le harness refuse maintenant les cas réels sans revue de confidentialité, mesure les objets sémantiques séparément, exige la version du dataset et garde les erreurs techniques hors de `NO_MARKER`. Le registre complet dispose d'un audit exploitable par les annotateurs. L'exporteur produit des IDs pseudonymisés, une séparation development/holdout stable par relation et un fichier local protégé.

## Risques restants

- Deux annotateurs issus du même cadre mental peuvent partager les mêmes biais ; l'arbitrage et les désaccords doivent rester visibles.
- Une anonymisation excessive peut supprimer les indices de rôle, cible ou temporalité ; la revue doit retirer seulement les identifiants inutiles.
- Le holdout est petit et pourrait ne contenir aucun exemple de marker rare ou critique.
- S07/K06 ne doivent produire aucun effet autoritaire avant preuve suffisante et revue humaine.
- Les données des fondateurs vérifient le pipeline, pas la représentativité statistique du futur produit.

## Dette restante

1. Revue de confidentialité des 23 candidats et enrichissement du contexte utile.
2. Annotation indépendante par deux humains, puis arbitrage par une troisième passe explicite.
3. Augmentation raisonnée du corpus, notamment négatifs difficiles, contradictions, rôles, engagements conditionnels, S07/K06 et absence de contexte.
4. Exécution A/B versionnée sur development, choix selon métriques, puis holdout gelé.
5. Décision `reg-v6.1` éventuelle fondée sur ces résultats.

## État distant

L'accès Management read-only est fonctionnel. L'inventaire de sources ci-dessus a été relu le 17 septembre 2026. Aucune donnée distante n'a été modifiée. Les quatre fonctions Edge V6 et l'état distant validés en Phase 1 restent la dernière configuration déployée ; les changements locaux d'évaluation de Phase 2 ne sont pas déployés et n'ont pas besoin de l'être pour l'annotation.

## NO GO Phase 2

**NO GO.** L'analyse sémantique n'est pas suffisamment démontrée sur un Gold Dataset humain, car il n'existe encore aucun cas avec revue de confidentialité, deux annotations humaines indépendantes et arbitrage. Le travail autonome possible est terminé sans fabriquer cette preuve.

Pour débloquer : désigner deux annotateurs humains indépendants et un arbitre (l'arbitre peut être l'un des deux après gel des réponses si cette règle produit est acceptée), leur faire traiter d'abord les 21 cas development privés selon `ANNOTATION_GUIDE.md`, puis lancer les expériences. Les 2 cas holdout restent invisibles aux choix de prompt/modèle jusqu'au gel de la variante. Ce holdout est trop petit pour conclure et devra être enrichi avant le gate. La dernière phase validée reste **Phase 1 — GO**.
