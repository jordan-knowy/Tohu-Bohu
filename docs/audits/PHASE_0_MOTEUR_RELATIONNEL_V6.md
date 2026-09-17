# Phase 0 — Audit du moteur relationnel et de ses dépendances

Date : 17 septembre 2026. Référence Git : `f34a7f5b216fa708c128f75ce441093b808d9ed1`, **plus les modifications locales présentes au début de l'audit** (notamment fiche Personne et `behavior-analysis.ts`).

## Décision proposée

**Ne pas basculer V6 en autorité unique à ce stade.** Le dépôt contient un noyau V6 utile, mais le produit reste hybride. Des problèmes de déterminisme, de périmètre des dyades, de fiabilité, de temporalité et de traçabilité empêchent de considérer les scores comme une vérité relationnelle validée.

L'objectif reste la suppression du Legacy. La prochaine phase devrait sécuriser la chaîne de preuve et rendre le calcul reproductible et évaluable avant de migrer ses consommateurs. Aucun paramètre, moteur, flag, cron ou schéma applicatif n'a été modifié pendant cet audit.

## Périmètre et niveau de preuve

Audit statique du code frontend, des fonctions serveur, des migrations, des producteurs/consommateurs de scores, des détecteurs et des tests ; exécution de la suite existante et de contre-exemples synthétiques. Les rapports antérieurs ont servi de pistes, jamais de preuve de l'état actuel.

La production **n'a pas pu être inspectée** : `supabase functions list --project-ref bgmtzwfafcgjklgygvtx --output json` renvoie un refus de privilèges ; `supabase migration list --linked` indique que le checkout n'est pas lié. Aucun accès aux comptes réels, aux flags effectifs, aux définitions SQL déployées, aux exécutions cron, aux volumes de markers ou aux métriques LLM n'est donc certifié ici. Pas d'appel LLM payant, pas de déclenchement de batch, pas de mutation distante.

Notation : **démontré** = code lisible ou contre-exemple exécuté ; **risque** = conséquence conditionnelle du code ; **à vérifier en production** = dépend d'un état distant inaccessible. L'audit du dépôt est livré ; la validation opérationnelle et empirique reste ouverte.

## Architecture réellement présente

```text
Emails / réunions / transcripts / connecteurs
  ├─ analyse comportementale LLM → cognitive_profiles.trust_score/satisfaction_score
  │    └─ score-batch Legacy
  │         ├─ cognitive_profiles.engagement_score + axes
  │         ├─ contact_score_history / relationship_snapshots
  │         ├─ person_relationship_score_snapshots
  │         ├─ account_relationship_score_snapshots
  │         └─ recommandations personne/compte
  ├─ person_key_moments / person_memory_entries
  │    ├─ classify-markers → scoring.marker_event
  │    └─ promotion des faits → account_facts / account_fact_evidence
  └─ messages + participants → detect-dyad-markers → scoring.marker_event
       └─ score-batch-account-v6
            ├─ buildDyadScoreSnapshot → scoring.score_snapshot(dyad)
            └─ calculateAccountWeatherCore → scoring.score_snapshot(account)
                 └─ account_brain → certaines sections de fiche Compte

Fiche Personne : score V6 conditionnel + fallback et métadonnées Legacy
Home / listes / digest / briefs : Legacy
Ask Tohu : contexte comptes/contacts/signaux, sans contrat d'état V6
```

Il n'existe pas encore de couche universelle normalisée `EVENT → FACT → MARKER`. Les détecteurs écrivent directement des markers ; les faits compte et les mémoires personne constituent des branches distinctes. `account_brain` rassemble des données de provenance hétérogène : météo V6, lecture stratégique fondée sur le Legacy et recommandations existantes.

## Cartographie des autorités et dépendances

| Surface / sortie | Autorité effective dans le code | Références |
|---|---|---|
| Liste Personnes | `cognitive_profiles.engagement_score`, `contact_score_history` | `src/person-list/service.ts:65`, `mapping.ts` |
| Fiche Personne, score/axes | V6 si statut non cold-start, verdict vrai et score présent ; sinon cascade Legacy | `src/person-detail/mapping.ts:692–745` |
| Fiche Personne, phase/delta/fiabilité/date/historique | Legacy même quand le score est V6 | `src/person-detail/mapping.ts:793`, `buildScoreHistory` |
| Liste Comptes | Snapshot compte Legacy ; repli moyenne contacts | `src/account-list/service.ts:76`, `mapping.ts` |
| Fiche Compte, données générales/personnes/historique santé | Legacy, dont RPC `account_health_monthly` | `src/account-detail/service.ts:72,78,137,298` |
| Fiche Compte, météo | `account_brain.weather`, V6 sous `scoring_v6_ui` | `AccountRelationView.tsx:664`, `AccountWeatherV6.tsx:244` |
| Fiche Compte, lecture stratégique | LLM alimenté par snapshots Legacy et scores cognitifs | `supabase/functions/account-strategic-reading/index.ts:86–150` |
| Engagements compte | `account_facts_live` via brain ; états utilisateur séparés | migration `20260916100000_account_engagement_actions.sql` |
| Historique compte | Mélange selon bloc : faits/promotions et snapshots Legacy ou V6 | `AccountRelationView.tsx`, `AccountWeatherV6.tsx`, service compte |
| Home et priorités | Scores Legacy, heuristiques `priorityOf`, risques et engagements mémoire | `src/home/service.ts:420,436`, `src/home/priority.ts:156` |
| Données partagées / recherche | Score contact = snapshot engagement ou profil cognitif | `src/services/data.ts:140–176` |
| Recommandations | `score-batch` + lecture stratégique ; relevance V6 limité aux faits | `score-batch/index.ts:528,574,760`, `services/relevance/` |
| Briefs | Snapshots Legacy compte/contact | `generate-briefs/index.ts:105,120,238` |
| Digest hebdomadaire | Snapshots compte Legacy et différences entre observations | `send-weekly-digest/assemble.ts:33–60` |
| Alertes / nurturing / préparation réunion | Consommateurs de signaux, briefs et profils ; dépendances indirectes à conserver dans la migration | fonctions `send-alerts`, `send-nurturing`, `send-meeting-prep` |
| Ask Tohu | 50 comptes, contacts et signaux par requête ; aucun snapshot V6, engagement ou brain interrogé | `ask-tohu-proxy/index.ts:29–50` |

Les appels explicites Legacy depuis les actions utilisateur sont dans `src/person-list/service.ts:168,172,225,239`, `src/account-list/service.ts:180,313,314,330`, `src/account-detail/service.ts:422`, `src/home/render.ts:532`. Leur suppression nécessitera un mécanisme V6 de recalcul après suivi, archivage et import.

### Exécution et persistance

- Legacy : cron déclaré `tohu-bohu-score`, `15 */6 * * *` (migration de renommage `20260720124500`), plus appels UI. `score-batch` produit aussi les recommandations et la qualification de relation : supprimer cette fonction prématurément retirerait des fonctions autres que le score.
- V6 : cron compte déclaré à `20 */6 * * *`, classifier à `13 */6 * * *`. Le commentaire évoque un détecteur à `:10`, mais aucune migration de sa planification n'a été retrouvée.
- Les décalages horaires ne prouvent pas la réussite ni l'achèvement des étapes précédentes. Aucun identifiant de run partagé ni barrière de complétude n'est transmis.
- Sept RPC utilisées n'ont **aucune définition dans les migrations du dépôt** : `upsert_person_marker_events`, `upsert_dyad_weather_snapshot`, `upsert_account_weather_snapshot`, `get_account_prev_weather_score`, `get_dyad_weather_snapshot`, `get_account_dyad_snapshots`, `account_health_monthly`. Elles peuvent exister à distance ; leur comportement, droits, filtrage et reproductibilité locale ne sont pas auditables ici.
- `scoring_v6_ui` est consulté sur la fiche Compte. Le chemin Personne n'est pas conditionné par ce flag. Les noms `scoring_v6_shadow`, `account_brain_v2`, `relevance_engine_v1` existent, mais aucun contrôle de ces flags n'a été retrouvé dans les producteurs V6 étudiés. Ne pas considérer leur désactivation comme un arrêt du pipeline.

## Constats bloquants avant autorité V6

### B01 — Même ensemble de preuves, résultat différent selon l'ordre

**Démontré par exécution.** Avec un marker R01 positif et un négatif de même magnitude, la réciprocité vaut **56** dans un ordre et **44** dans l'autre. Le tri utilise magnitude puis `markerId`, sans départager le sens (`calculateDyadScoreCore.ts:103`). La réduction par rang attribue donc le poids maximal au premier des deux. Même défaut dans la copie serveur.

Conséquence : un ordre SQL ou d'ingestion peut changer le score sans changer la réalité. Proposition : définir une règle stable pour contributions opposées de magnitude égale, comparer les alternatives avant/après et versionner la décision. Un simple tri par sens rétablit la stabilité mais introduit un biais de signe à discuter ; ne pas le présenter comme une calibration empirique.

### B02 — Une « dyade » est actuellement un contact agrégé

`detect-dyad-markers` regroupe les messages par `contact_id`, toutes sources/utilisateurs confondus. Le batch V6 calcule et persiste par contact, sans `collaborator_user_id` ; pourtant le schéma marker prévoit ce champ et `dyad_id`. Le RPC Personne ne reçoit que `contact_id` alors que le reste de la fiche supporte des visions individuelles.

Conséquence : les interactions de deux collaborateurs avec une même personne peuvent produire une seule baseline, un seul score et une réciprocité artificielle. Décision nécessaire : distinguer dyade `(organisation, collaborateur, contact)` et agrégation personne/équipe. Le contexte d'identité doit être conservé depuis l'événement jusqu'au snapshot.

### B03 — Fiabilité non mesurée et garde-fous contournés

Dans `score-batch-account-v6/index.ts:225–247`, couverture des canaux, identité et diarisation sont fixées à **1** ; `hasX01` est omis et `hasX02=false`. Le plafond P4 calculé dans la baseline n'est pas propagé. Les rôles dyadiques utilisent toujours `UNQUALIFIED_ROLE`.

Le filtre `!snapshot.coldStart && snapshot.core` ignore statut actif/rompu, verdict et fiabilité. **Exécuté :** une dyade mature sans marker donne score 50, fiabilité 0, verdict faux, et passe ce filtre. Le batch compte ne passe jamais par `buildAccountWeatherSnapshot` ; il ne transmet ni reliability ni verdict à son RPC d'écriture.

Proposition : contrat d'admissibilité explicite et état inconnu pour les qualités non mesurées ; aucun 1 implicite. Comparer couverture/pertes de données et faux verdicts avant de définir les seuils. Conserver les scores exploratoires séparés des états affichables.

### B04 — Mélange V6/Legacy et contrôle d'affichage incomplet

La fiche Personne remplace score/axes, mais conserve phase, delta, confiance, date et historique Legacy. `dyadUsable` ne consulte pas reliability et admet un statut rompu si les autres conditions passent. Une relation peut donc avoir une valeur V6 accompagnée d'une explication de variation d'un autre moteur.

Sur compte, `WeatherHero` utilise uniquement `status='available'` pour afficher score et météo colorée. `WeatherSection` appelle `displayRule` seulement si les valeurs de fiabilité et verdict sont non nulles ; les tuiles restent rendues. Le RPC brain marque tout snapshot comme disponible, sans condition de fiabilité. L'absence de fiabilité ne constitue donc pas un blocage d'interprétation cohérent.

Proposition : livrer score, état, fiabilité, date, version, historique et explication dans un même contrat. En Phase 1, définir ce contrat sans activer une bascule produit globale.

### B05 — Chaîne non reconstructible depuis Git

Les RPC manquantes ci-dessus empêchent de prouver les garanties d'insertion, les contraintes de déduplication, la conservation des versions et les permissions. Les modules frontend et serveur sont dupliqués ; snapshots serveur est une copie partielle sans couche compte. Les tests purs frontend ne prouvent pas le batch déployé. `tsconfig.json` n'inclut que `src`.

Proposition : récupérer en lecture seule les définitions déployées, les versionner après revue, reconstruire une base de test vide puis tester contrats, droits et parité frontend/serveur. Aucun déploiement préalable à cette revue.

### B06 — Contrôles d'accès du pipeline à vérifier et corriger

`classify-markers/index.ts:141` exécute le chemin `organizationId` avec le client service-role **avant** `isAuthorized`, sans vérification d'appartenance. Les chemins cron de classifier et batch acceptent un payload JWT décodé avec `role=service_role` sans validation cryptographique locale. L'exploitabilité de ce second point dépend du contrôle gateway déployé ; il n'a pas été testé à distance.

Les RPC `get_person_marker_events` / `get_account_k_marker_events` de la migration `20260916110000` sont `SECURITY DEFINER` sans contrôle d'accès interne ni GRANT/REVOKE dans cette migration. Les ACL antérieures sont inconnues. Une installation neuve et une installation existante peuvent donc diverger. Tester anonymes, membres d'autre organisation et visions restreintes ; borner explicitement les droits. Ce sont des observations directes sur la chaîne de preuves, pas une certification de sécurité globale.

## Qualité des sources, faits et compréhension

### Sources et normalisation

- Gmail/Microsoft : corps analysés puis `body_text:null`, conservation from/to/date/thread et `metadata.user_id` (`sync-email-analysis:1222,1740`). Les messages n'alimentent qu'un `primaryContact`, sans arêtes distinctes pour tous les destinataires ni CC fiable. Le recalcul sémantique exhaustif des emails historiques n'est pas possible depuis ces seules lignes.
- L'extraction d'engagements vérifie la présence de la citation dans le corpus normalisé : garde-fou réel à conserver (`sync-email-analysis:785–803`, `ingest-transcript:102–112`). Cela ne garantit pas seul le bon locuteur, le bon événement ou l'interprétation conditionnelle. La date est encore issue de l'extraction ; aucun identifiant de span brut universel n'accompagne chaque fact.
- Réunions : participants, transcripts et attribution de locuteurs existent. Dans le détecteur, une participation enregistrée et une date passée sont utilisées comme présence ; invitation, participation effective, annulation et événement futur doivent rester distincts. **Exécuté : A01 accepte une réunion future non tenue comme deuxième canal actif.**
- Slack stocke des messages à périmètre utilisateur pouvant ne pas avoir de `contact_id` ; le détecteur V6 par contact ne les récupère pas automatiquement. Notion et les autres connecteurs possèdent leurs chemins d'analyse propres. La couverture de leurs faits jusqu'aux markers n'est pas démontrée.
- Pas de contrat commun vérifié pour `event_time`, `ingested_at`, acteur, destinataires, organisation, owner, preuve, canal, complétude et version d'extraction.

### Identités et rôles

À conserver : résolution organisationnelle par alias, email principal/secondaire, exclusion des emails internes et verrou transactionnel (`20260911103000`). Le matching transcript rejette plusieurs homonymes exacts et conserve null plutôt qu'inventer (`ingest-transcript:232`).

Risques démontrables : le fallback SQL sans email choisit le premier nom normalisé du même compte via `LIMIT 1`, y compris deux homonymes ; les emails dupliqués choisissent aussi le plus ancien. Un prénom unique peut identifier un locuteur transcript sans que cette unicité soit une preuve suffisante. La qualité de matching n'est pas transmise au calcul.

`account_contact_roles` contient source, date d'observation, confiance et `active`, mais sa contrainte unique `(organisation, compte, contact)` ne représente pas plusieurs périodes de rôle. Pas de validité début/fin ni de résolution historique de l'autorité. Le batch mappe les rôles inconnus sur utilisateur (0,3), les sponsors/champions sur influenceur (0,6), et qualifie les relations sur le volume email. Ces hypothèses existent ; leurs justifications empiriques ne sont pas établies par le dépôt. La qualité du rôle et l'absence de qualification doivent rester distinctes.

### Faits et engagements

Le schéma `account_facts` est une bonne base : types séparés, preuves multiples, source, confiance, résolution, fenêtre d'échéance et état utilisateur. Il n'impose pas que tout fait soit un marker. En revanche :

1. Aucun appel de `promoteAccountFacts`, `promote_account_facts` ou des RPC de réconciliation n'a été retrouvé dans les parcours applicatifs recherchés ; un appel externe reste possible mais non vérifié.
2. La promotion SQL est `ON CONFLICT DO NOTHING`, alors que le runner TS sait mettre certains états à jour : une résolution ultérieure de mémoire personne peut ne pas atteindre le fait compte via SQL. Les deux implémentations ne sont pas équivalentes.
3. La promotion SQL fixe `source_type='email'` pour moments et engagements, même si la source est une réunion. La vue `has_verbatim` signifie seulement qu'un excerpt non nul existe, ce qui inclut des summaries LLM promus.
4. Le batch définit « tenu » comme `resolved_at && !is_overdue`. Or `is_overdue` n'est vrai que pour un fait **actif** : un engagement résolu après son échéance est compté tenu ; un retard résolu disparaît des glissements. Il faut comparer date de réalisation et échéance, et distinguer tenu/annulé/écarté.
5. La fenêtre d'engagements filtre `occurred_at >= J-90` : une ancienne promesse toujours ouverte peut sortir du solde. Aucun contrat commun de synchronisation des actions personne/compte n'est démontré.

### LLM : frontière encore violée et couverture limitée

Le Legacy reçoit directement `trust.score` et `satisfaction.score` 0–100 de `behavior-analysis.ts:333–334`, puis les intègre dans `score-batch:424–429`. Le calcul arithmétique est déterministe mais deux entrées restent des notes LLM. Les traits cognitifs descriptifs ne sont pas tous des scores relationnels à supprimer ; isoler précisément les champs qui influencent la relation.

Le classificateur V6, lui, ne produit pas de score : registre fermé de 10 markers, abstention `NO_MARKER`, date obligatoire, candidats sous confiance 0,75, S07 exigeant un verbatim. Mais il :

- analyse un résumé ou extrait isolé, sans chronologie ni baseline ni locuteurs structurés ;
- demande **un seul marker**, ce qui empêche de représenter plusieurs signaux contradictoires dans le même extrait ;
- confond potentiellement appréciation négative d'un incident et satisfaction envers la relation (S03), faute de cible sémantique structurée ;
- utilise le même seuil déclaré pour tous les markers, y compris S07 ; la confiance auto-déclarée n'est pas une probabilité calibrée ;
- ne couvre aucun K01–K09 ; aucun producteur général de ces K n'a été retrouvé ;
- lit au plus 40 moments et 40 engagements par défaut, sans ordre, curseur ni exclusion des éléments déjà classés ; peut retraiter un même sous-ensemble indéfiniment et laisser les nouveaux hors couverture ;
- range échec HTTP/JSON dans l'absence de marker ; des erreurs peuvent devenir de faux résultats négatifs silencieux ;
- persiste `detector_version` mais pas de `prompt_version`, modèle, résultat brut/NO_MARKER ni identifiant d'expérience par élément ;
- duplique le prompt/parseur testé dans une fonction serveur différente.

La volontarité existe comme coefficient **du type de marker**, pas comme catégorie contextualisée par événement. L'intensité est essentiellement le palier du registre, pas `low/medium/high/critical` justifié pour chaque observation. Les escalades K02/K07 mentionnées dans le registre ne disposent pas d'une implémentation événementielle visible correspondante. Il faut construire les catégories et leurs définitions avant de les calibrer, sans note relationnelle libre donnée au LLM.

## Temporalité, calcul, causalité et robustesse

| Constat | Preuve / conséquence | Proposition à comparer et tester |
|---|---|---|
| Fenêtre dyade sans borne ancienne | `snapshots.ts:88` filtre seulement `observedAt <= T` ; S07 de 2020 plafonne toujours S à 20 en 2026 dans le contre-exemple | Cycle de vie explicite, résolution et fenêtres par famille ; ne pas inventer un decay universel |
| `decay` actuel non temporel | Multiplicateur selon rang des contributions | Distinguer atténuation par rang, répétition et vieillissement dans paramètres/documentation |
| Rejeu partiel | `replay.ts:22–34` change T mais réutilise âge, épisodes, cadence, rôle et fiabilité actuels | Reconstituer tous les inputs à T, y compris versions/validité ; conserver observé alors vs corrigé depuis |
| P7 compte les lignes avant admissibilité registre | Cinq IDs inconnus donnent verdict vrai malgré score neutre, contre-exemple exécuté | Validation à l'entrée et compte des preuves admissibles indépendantes ; vérifier les RPC manquantes |
| S04 ne s'éteint pas automatiquement | Détecteur n'émet plus après réponse ; réconciliation ne vise que source `detector:communication_messages`, alors que le writer écrit `detector:detectors-v1` | Rétraction lors de changement de vérité, pas uniquement suppression de source |
| Réconciliation étroite | SQL traite seulement S04/source ci-dessus ; pas markers sémantiques ni A/R | Invalidation des dépendances, historique de corrections et recalcul aval |
| A01/A02 clés synthétiques | `evidenceRef='channels'/'continuity'`, clé dédup sans période ; nature upsert inconnue | Séparer observation d'état et occurrence indépendante ; garder les IDs des événements supports |
| Répétition = nombre de lignes | Même réalité présente dans un moment et un engagement peut produire deux markers ; dédup par source dérivée | Dédup événementielle multi-source et preuve d'indépendance |
| Baseline contaminée par période récente | Période R01 45j incluse dans baseline 182j ; épisodes = messages + réunions, pas séquences indépendantes | Comparer baseline antérieure, robustesse aux rafales et cadence par dyade/canal |
| Faux delta de dynamique | Batch fixe `delta30OtherDials:0` | Lire/rejouer cinq cadrans précédents ; inconnu si borne absente |
| Delta « 30 jours » approximé | Score compte comparé au mois civil précédent | Nommer période réelle ou calculer T−30j ; ne pas mélanger les deux |
| Absence d'échanges transformée en mesure | Avec un owner et un contact jamais contacté : dynamique 70, score compte 24, contre-exemple exécuté | Cadrans non observables null, aucune pénalité ou satisfaction implicitement mesurée |
| Réunions seules exclues des dyades | Batch `if (contactMessages.length === 0) continue` | Épisodes multicanaux admissibles ; contacts sans compte également à prendre en charge |
| Population de calcul divergente | Batch prend tous les contacts non fusionnés, sans filtre de suivi/archivage personne ; UI filtre les suivis | Contrat de population versionné partagé par calcul/UI |
| Cadence contaminée par futur | Réunions compte lues sans borne temporelle ; dernier échange peut être futur | Filtrer événements tenus à T ; séparer planifié/observé |
| Qualité d'ingestion invisible | Batch/détecteur sans pagination ; `max_rows=1000` local, erreurs de plusieurs lectures ignorées (`data ?? []`) | Pagination ordonnée, erreurs bloquantes par source, indicateur de complétude et conservation du dernier bon état |
| Fiabilité compte partielle | Wrapper pur prend min des cadrans calculables à poids nominal >=15 %, ignore cadrans null et poids redistribués | Mesurer séparément couverture et fiabilité ; comparer comportements sur comptes partiels |
| Preuves et contributions confondues | Batch ajoute aux modifiers des preuves avec `contribution=±1`, points=0 ; inclut aussi events de dyades cold-start avant exclusion | DTO séparé preuves vs contributions calculées ; traçabilité exacte des entrées utilisées |
| Causalité des deltas absente | Contributions d'axes disponibles, mais pas décomposition T−1→T prenant en compte rang, plafonds, poids et populations | Attribution calculée se réconciliant au delta total ; texte LLM et hypothèses dans champs distincts |
| Dernier échange personnel incomplet | Brain filtre email sur `source_owner_user_id` ; ingestion email remplit `metadata.user_id` | Normaliser owner ; tester compte email-only et visions équipe/personnelles |

L'absence de borne basse ou de decay n'est pas, isolément, la preuve qu'un marker doit expirer après N jours. Le problème démontré est l'absence de cycle de vie/contextualisation suffisamment explicite pour justifier son effet actuel. Les nouveaux seuils doivent suivre le protocole empirique demandé.

## Validation actuelle et qualité démontrée

Commandes exécutées sur le working tree :

- `npm run check` : succès. Portée limitée à `src`, pas vérification TypeScript/Deno des handlers.
- `npm test` : **328 réussites, 8 échecs, 336 tests ; 31 fichiers réussis, 1 en échec**. Les huit échecs sont dans `supabase/functions/sync-slack/index.test.ts` (reprise, curseur, fenêtre et attribution). L'audit n'a changé aucun code testé ; les rapports précédents mentionnaient déjà huit échecs, sans que cela prouve une cause identique.
- `node docs/audits/v6-phase0-repro.mjs` : succès d'exécution ; reproduit les sept observations décrites. Ce script observe les défauts actuels, il ne prétend pas être une suite de validation verte du moteur.

Les tests V6 existants vérifient des fixtures, formules, parsing, affichage et règles pures. Ils ne démontrent ni précision sémantique en production, ni qualité des attributions, ni calibration des poids, ni équivalence avec l'analyse humaine. Les fixtures 55/33 sont des références d'implémentation, pas du ground truth relationnel.

Aucun Gold Dataset annoté humainement ni harness de précision/rappel par marker n'a été trouvé dans le périmètre recherché. Aucun chiffre de performance métier ne peut être honnêtement fourni. Les contre-exemples ajoutés sont **synthétiques et non annotés humainement**.

## Protocole Gold Dataset proposé, avant calibration

Livrable de Phase 1, pas des annotations fabriquées par cet audit :

1. Sélectionner des séquences réelles autorisées puis anonymisées, stratifiées par canal, type de relation, maturité, incidents, réparations, silence et ambiguïté d'identité ; inclure comptes riches, vides, partiels, réunions seules et plusieurs collaborateurs.
2. Chaque cas conserve IDs anonymisés, événements datés, locuteurs/rôles, contexte avant/après, preuves et périodes d'observation. Annoter markers attendus **et interdits**, faits non scorables, engagements (owner/condition/échéance/réalisation), rôles temporels, direction attendue du score et causes attendues. Autoriser « indéterminable ».
3. Deux annotations indépendantes puis arbitrage ; consigner annotateurs, désaccords et version. Séparer entraînement/calibration et holdout par relation/compte pour éviter la fuite d'information ; conserver un test temporel.
4. Exécuter A/B à corpus, modèle et paramètres explicitement versionnés : `dataset_version`, `classifier_version`, `prompt_version`, `model`, résultat complet, abstention/erreur, coût et latence. Legacy seulement comme comparaison historique.
5. Mesurer TP/FP/FN, précision/rappel/F1 par marker et par impact, faux S07/K06, erreurs d'identité/direction, fidélité des citations, engagements conditionnels mal acceptés, contradictions perdues, cohérence du sens de variation. Séparer erreurs techniques, abstentions et vrais négatifs. Publier effectifs et incertitude, pas seulement une moyenne.
6. Choisir les seuils d'acceptation à partir des coûts de faux positifs et résultats, avec une exigence plus forte pour les plafonds critiques. Aucun seuil chiffré n'est présenté ici comme validé.
7. Pour toute évolution de registre/poids/decay/autorité : problème illustré, proposition versionnée, comparaison avant/après cas par cas, régressions, résultats holdout, décision documentée et possibilité de rejeu.

Cas minimaux : « client frustré par une panne mais confiant envers son interlocuteur », « validation sous réserve de budget », « promesse annulée vs tenue en retard », « négatif et positif dans la même réunion », « décideur parti », « homonymes », « silence habituel huit jours vs silence inhabituel cinq jours », « action spontanée vs troisième relance », « preuve corrigée/supprimée », « futur/réunion annulée », « ordre des marqueurs inversé ».

## Valeur du graphe relationnel

Pas de justification actuelle pour introduire une base graphe. Contacts, organisations, owners, participants, messages, rôles et faits permettent déjà un graphe logique SQL : arêtes datées collaborateur↔contact, contact↔compte, participation et introduction prouvée.

Commencer par couverture pondérée, concentration HHI, nombre de liens internes réellement actifs, dépendance à un interlocuteur et chemin connu vers un décideur. L'HHI existe déjà. Ne pas assimiler owner administratif à porteur relationnel actif, co-présence à influence ou centralité à pouvoir de décision. Les introductions et relations internes nécessitent des arêtes prouvées aujourd'hui insuffisamment structurées. Évaluer coût/latence et utilité explicative avant toute nouvelle infrastructure.

## Phase 1 proposée — à décider, non engagée

Ordre recommandé, avec résultats reviewables :

1. **Reproductibilité et périmètre** : inventaire distant en lecture seule, migrations manquantes, ACL, crons effectifs, définition dyade/personne/compte/vision ; sauvegarde d'audit des états Legacy et V6 avec versions et provenance.
2. **Intégrité du calcul** : ordre invariant, entrées admissibles, pagination/erreurs, dates futures, résolution des markers, qualité inconnue explicite, tests des batches et parité des deux copies. Pas de recalibration opportuniste.
3. **Contrat relationnel commun** : faits/markers/engagements/rôles séparés ; état, score, fiabilité, couverture, dates, versions, causes calculées et preuves. Définir le comportement sur absence/échec/incomplétude.
4. **Évaluation humaine et sémantique** : premier Gold Dataset réellement annoté ; instrumentation d'expériences et calibration par impact ; analyse contextualisée produisant plusieurs faits/markers et abstentions.
5. **Préparation de la migration** : adaptateurs et comparaison d'autorité sur les consommateurs inventoriés, contrôles de cohérence score/historique/recommandations/Ask. La décision de bascule reste distincte, après résultats.

Questions produit à trancher sur pièces lors de cette phase : portée exacte d'une dyade et des visions ; politique de conservation des preuves brutes/extraits ; sens de « actif », « tenu », « résolu » et « couvert » ; représentation de l'inconnu ; rôle des catégories non qualifiées. Ces décisions ne sont pas remplacées par des constantes nouvelles dans cet audit.

## Conditions mesurables de retrait du Legacy

| Condition de sortie | Preuve attendue | État au présent audit |
|---|---|---|
| Tous consommateurs V6 | Inventaire sans lecture autoritaire Legacy, tests UI/API/Ask cohérents | Non atteint |
| Aucun fallback Legacy | Erreur/absence V6 → état explicite, jamais autre moteur | Non atteint |
| Aucun calcul cron Legacy | Inventaire `cron.job`, journaux d'exécution, suppression planifiée du job | Cron encore déclaré, état distant inconnu |
| Aucune fonction Legacy au service du produit | Aucun appel UI/job ; responsabilités utiles migrées avant retrait | Non atteint |
| Scores/versions cohérents | Même contrat pour score, date, fiabilité, historique, explication | Non atteint |
| Colonnes dépréciées | Dictionnaire des champs, dates de retrait, absence d'écriture/lecture | Non atteint |
| Audit archivé | Archive immuable des anciens états, paramètres, preuves et comparaison | Non démontré |
| Code mort retiré | Suppression revue après zéro dépendance, migration depuis base vide validée | Non commencé, conforme à Phase 0 |
| Pertinence démontrée | Résultats Gold Dataset/holdout, régressions, cas critiques et taux d'abstention | Non démontré |

Ne pas supprimer la table `cognitive_profiles` entière : elle porte aussi des descriptions comportementales utiles. Déprécier les champs autoritaires Legacy précisément (`trust_score`, `satisfaction_score`, `engagement_score`, axes/deltas/phases correspondants), ainsi que les tables de snapshots/historiques Legacy après migration et archivage. Les faits, preuves et engagements restent des composants du futur moteur ; « V6 unique » ne signifie pas « tout transformer en marker ».

## Vérifications distantes restantes

Récupérer les définitions et ACL des RPC manquantes ; comparer migrations déployées et Git ; vérifier les versions et paramètres réellement utilisés, la configuration JWT, les flags, la pagination effective, les crons et leurs erreurs. Mesurer ensuite par organisation et canal : complétude d'ingestion, répartition candidats/acceptés/obsolètes, couverture K/C/S/E/R/A, dates des snapshots, identités ambiguës, rôles qualifiés, doublons, qualité des citations, population suivie et scores sans preuves admissibles.

Échantillonner des comptes réels de référence avec preuves anonymisées et annotations humaines est indispensable pour conclure sur la pertinence. Les anciens rapports indiquant tables vides, couverture faible ou vérification « E2E » sont historiques : leur validité actuelle n'a pas été confirmée.

Fichiers de livraison : ce rapport, le [script de contre-exemples](v6-phase0-repro.mjs), ses [résultats](v6-phase0-repro-results.json), et l'[inventaire textuel des dépendances](v6-phase0-dependencies.md). Aucun de ces fichiers n'active la Phase 1.
