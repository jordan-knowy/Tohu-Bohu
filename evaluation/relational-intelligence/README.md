# Relational intelligence evaluation

Les 15 cas fournis sont des **gabarits synthétiques non annotés**, exclus des métriques humaines. Aucun score précis n'est une annotation attendue. `harness.ts` définit et valide le schéma : contexte temporel, événements, participants, faits/markers attendus et interdits, engagements, rôles, direction qualitative, champs indéterminables. Deux annotateurs distincts et une arbitration conservant les désaccords sont obligatoires pour un cas évalué.

Remplacer les gabarits par des séquences réelles autorisées et anonymisées, marquées `human_real`. Scinder par `group_id` de compte/relation : un groupe ne peut appartenir à development et holdout. Conserver le holdout hors des choix de prompts/poids/seuils. L'arbitrage ne gomme pas les annotations initiales. Conserver identifiants de versions, citations vérifiées et instant des corrections.

Commande :

```sh
node evaluation/relational-intelligence/run.mjs evaluation/relational-intelligence/cases.templates.json evaluation/relational-intelligence/predictions.empty.json development
```

Le résultat initial est `evaluated: 0`, sans précision fictive. Les prédictions sont comparées par marker ; absence de prédiction = erreur technique, abstention et erreur conservées séparément (les markers attendus restent des faux négatifs). Précision/rappel/F1 sont null si le dénominateur est nul. S07 et K06 ont toujours une ligne critique. Une expérience ne mélange pas plusieurs versions modèle/prompt/classifier/registre. Le protocole de validation doit publier les effectifs et les intervalles d'incertitude avant toute calibration ; aucune performance humaine n'est revendiquée aujourd'hui.
