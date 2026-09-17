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

## Procédure locale exacte

Les commandes se lancent depuis la racine du repository. Chaque serveur écoute uniquement sur `127.0.0.1`. Fermer le serveur avec `Ctrl+C` après la passe.

### 1. Revue confidentialité et annotabilité

```sh
node evaluation/relational-intelligence/annotation-tool.mjs serve privacy privacy-reviewer 4179
```

Ouvrir `http://127.0.0.1:4179`. Vérifier les 35 cas, corriger dans l'interface les éventuels noms résiduels, confirmer ou refuser l'annotabilité et préciser `complete`, `partial` ou `insufficient`. Un cas impossible à interpréter doit recevoir un motif ; il ne sera pas envoyé à A/B.

Après le dernier cas :

```sh
node evaluation/relational-intelligence/annotation-tool.mjs freeze privacy privacy-reviewer
```

Le gel refuse automatiquement tout email ou URL encore présent. Les suites numériques ambiguës (date, montant, référence ou téléphone) restent soumises à la décision explicite du privacy reviewer afin de ne pas supprimer un contexte temporel ou commercial utile.

### 2. Deux annotations indépendantes

Annotateur A :

```sh
node evaluation/relational-intelligence/annotation-tool.mjs serve A annotateur-a 4179
node evaluation/relational-intelligence/annotation-tool.mjs freeze A annotateur-a
```

Annotateur B, sur un autre port ou après fermeture de A :

```sh
node evaluation/relational-intelligence/annotation-tool.mjs serve B annotateur-b 4180
node evaluation/relational-intelligence/annotation-tool.mjs freeze B annotateur-b
```

Les ordres diffèrent automatiquement. Chaque serveur ne charge que son fichier de réponses. Les identifiants `annotateur-a` et `annotateur-b` doivent désigner deux humains différents.

### 3. Divergences et arbitrage

```sh
node evaluation/relational-intelligence/annotation-tool.mjs diff
node evaluation/relational-intelligence/annotation-tool.mjs serve arbitration arbitre 4181
```

L'arbitre ne voit que les cas et champs divergents, avec les preuves laissées par A et B. Après traitement :

```sh
node evaluation/relational-intelligence/annotation-tool.mjs freeze arbitration arbitre
```

Le résultat privé est `evaluation/relational-intelligence/private/gold.v1.json`. Il contient l'enveloppe versionnée, les deux annotations originales, les désaccords et l'arbitrage final. Ne pas ouvrir les labels holdout pendant le choix des variantes.

## Temps humain minimal estimé

- confidentialité/annotabilité : 15 à 25 minutes pour 35 cas ;
- annotation A : 60 à 90 minutes ;
- annotation B : 60 à 90 minutes, réalisable en parallèle de A ;
- arbitrage : environ 15 à 30 minutes selon le nombre de divergences.

Le temps calendaire minimal est donc d'environ 1 h 30 à 2 h 25 si A et B travaillent en parallèle. Les cas déclarés impossibles lors de la revue réduisent ce temps et restent documentés hors métriques.
