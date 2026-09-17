# V6 — préparation non bloquante des Phases 3 à 5

Date : 17 septembre 2026  
Statut : inventaire préparatoire, aucune décision dépendante du Gold appliquée

## Phase 3 — contrats à finaliser après le gate Phase 2

La fondation sait déjà rejouer les événements datés, choisir le rôle déclaré avant le rôle inféré, séparer score/reliability/coverage et refuser un score autoritaire sans preuve. Le contrat `account_brain` existe. Il manque encore un contrat `person_brain` unique couvrant explicitement les trois niveaux dyade, équipe↔contact et compte, puis des causes mathématiques réconciliables avec chaque delta.

Le travail après Phase 2 devra stabiliser les champs communs suivants avant tout branchement UI : `state`, `score`, `dimensions`, `reliability`, `coverage`, `evidence`, `facts`, `commitments`, `roles`, `history`, `changes`, `causes`, `recommendations`, ainsi que les versions de registre, paramètres, fiabilité et calcul. Les décisions de poids, caps, seuils ou taxonomie attendent les preuves Gold.

## Phase 4 — consommateurs déjà identifiés

L'inventaire reproductible `scripts/v6-inventory-legacy-authority.mjs` analyse frontend, Edge Functions et migrations. Sa sortie `v6-phase4-5-consumer-inventory.json` sépare les autorités Legacy des lecteurs canoniques. Les principaux consommateurs de l'ancienne autorité encore actifs incluent actuellement :

- Home et liste Comptes : snapshots compte Legacy et fallback `public_context.relationship_score` ;
- fiche Personne : snapshots publics, `contact_score_history` et scores de `cognitive_profiles` ;
- briefs, digest et lecture stratégique : snapshots compte et historique personne Legacy ;
- déclenchements frontend directs de `score-batch` ;
- fonctions `score-batch` et `account-strategic-reading` elles-mêmes.

La présence de lecteurs `account_brain` et `get_dyad_weather_snapshot` ne suffit donc pas à rendre V6 autoritaire. Aucun de ces consommateurs n'est modifié avant la stabilisation des contrats Phase 3.

## Phase 5 — ordre de retrait préparé

L'ordre sûr sera : brancher tous les consommateurs sur les brains canoniques, désactiver les appels et crons Legacy, vérifier `OLD AUTHORITY = 0`, puis supprimer fonctions/tables/colonnes dérivées dans des migrations distinctes. Les sources emails, meetings, transcripts, contacts, engagements et provenance restent hors du périmètre de suppression.

Les chaînes contenant « legacy » pour des redirections d'URL, coordonnées importées ou migrations historiques ne sont pas automatiquement une autorité relationnelle. Le gate doit reposer sur les catégories sémantiques de l'inventaire, puis sur une inspection distante des crons, routines et objets avant DROP.

## Limites actuelles

Cette préparation ne constitue aucun GO Phase 3, 4 ou 5. Elle permet de démarrer immédiatement les contrats et migrations une fois Phase 2 validée, tout en évitant de calibrer ou de brancher une architecture dont la pertinence sémantique n'est pas encore démontrée.
