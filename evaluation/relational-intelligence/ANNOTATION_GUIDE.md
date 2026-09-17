# Guide d'annotation Gold V6

## Conditions d'entrée

Un cas `human_real` n'entre dans aucune métrique avant revue de confidentialité (`privacy_reviewed: true`). Cette revue retire les identifiants inutiles sans modifier les mots qui portent le sens relationnel. Les sources restent dans `private/`, ignoré par Git. Les résumés de `person_key_moments` sont des sorties LLM et ne constituent pas un Gold verbatim ; les premiers candidats utilisent uniquement les `source_excerpt` datés.

Les groupes sont séparés entre development et holdout par relation pseudonymisée. Aucun annotateur ne déplace un cas de split. Le holdout ne sert ni à écrire le prompt, ni à choisir le modèle, ni à régler un seuil.

## Annotation indépendante

L'annotateur A et l'annotateur B travaillent sur deux copies séparées et ne voient pas les réponses de l'autre. Pour chaque cas, ils renseignent :

- `expected_facts` : faits explicitement observables, sans score ;
- `expected_markers` : seulement les IDs dont la définition et la preuve sont satisfaites ;
- `forbidden_markers` : confusions plausibles qui seraient des faux positifs ;
- `expected_commitments` : `owner | bénéficiaire | objet | échéance | condition | état | volontarité`, avec `unknown` si absent ;
- `expected_roles` : rôle déclaré ou inféré, date, confiance et preuve ;
- `expected_direction` : `up`, `stable`, `down` ou `indeterminable`, sans produire un score numérique ;
- `indeterminable_fields` : toute information que la source ne permet pas de conclure.

Une frustration concernant un incident n'implique pas automatiquement S03. Une phrase conditionnelle ne devient pas un engagement ferme. Une réunion future ou annulée n'est pas un canal actif. Un signal positif et un signal négatif peuvent coexister. L'absence de preuve conduit à l'abstention, jamais à un marker par défaut.

## Arbitrage

L'arbitre reçoit les deux annotations seulement après leur gel. Il conserve chaque divergence dans `disagreements` et produit les labels finaux ; il ne réécrit pas les annotations A/B. S07 et K06 demandent un verbatim exact, une attribution certaine et une décision explicite de l'arbitre. Si le contexte manque, le résultat reste indéterminable.

## Expériences

Chaque prédiction renseigne `dataset_version`, `model`, `prompt_version`, `classifier_version` et `registry_version`. Une exécution ne mélange aucune de ces versions. On choisit sur development, puis on exécute une seule fois le holdout gelé. Toute modification après lecture du holdout crée une nouvelle version de dataset et un nouveau holdout.

Le rapport publie les effectifs TP/FP/FN, précision, rappel et F1 par marker, les faux positifs critiques S07/K06, les métriques séparées des faits/engagements/rôles, l'exactitude de direction, le taux d'abstention, les erreurs techniques et les désaccords d'annotation. Aucun pourcentage n'est interprété sans son effectif.
