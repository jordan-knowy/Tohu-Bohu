# Architecture du scoring — état réel au 2026-09-16

Ce document explique **pourquoi le même compte peut afficher deux scores différents** selon la page consultée (liste Comptes / Home vs onglet Météo de la fiche Compte). Il décrit ce qui existe réellement dans le code aujourd'hui, pas la cible.

## Le fait central : il existe DEUX moteurs de scoring, pas un

| | **Legacy** (en production, seul moteur qui alimente l'UI aujourd'hui) | **V6** (en construction, "shadow", pas branché en autorité) |
|---|---|---|
| Edge function | `supabase/functions/score-batch/index.ts` | `supabase/functions/score-batch-account-v6/index.ts` + `classify-markers/index.ts` |
| Calcul compte | `supabase/functions/score-batch/index.ts:625` | `supabase/functions/_shared/scoring-v6/calculateAccountWeatherCore.ts` (miroir de `src/services/scoring/calculateAccountWeatherCore.ts`) |
| Formule compte | **3 composantes** : `engagement×0.55 + couverture×0.25 + récence×0.20` | **6 cadrans pondérés** : Confiance/Réciprocité, Satisfaction, Dynamique, Couverture, Équilibre, Ancrage interne |
| Entrée du calcul | Statistiques d'activité (messages, meetings) + `cognitive_profiles.trust_score/satisfaction_score` (**nombres produits par le LLM**, `?? 50` en repli) | `scoring.marker_event` (marqueurs à preuve : evidence_ref + observed_at, registre fermé C01…A02/K01…K09/X01…X03) |
| Stockage | `public.account_relationship_score_snapshots` (colonne `score`, 1 ligne/compte/mois) + `cognitive_profiles.engagement_score` (niveau personne) | `scoring.score_snapshot` (schéma isolé `scoring`) |
| Déclenchement | Cron (visible dans `supabase/migrations`, ex. classify-markers cron ajouté aujourd'hui) + appels manuels (`trackCandidates`, `archiveAccounts`, bouton "score immédiat") | Pas de cron généralisé confirmé ; wiring prouvé manuellement sur quelques comptes témoins |
| Couverture réelle | Tous les comptes/contacts suivis | **Quasi vide en prod** : `scoring.score_snapshot` (compte) est vide car `account_contact_roles.decision_role` est vide à 100 % sur les organisations — impossible de calculer l'autorité de rôle requise pour Satisfaction/Confiance/Couverture |
| Statut produit | Autoritaire, consommé par toute l'UI historique | Feature-flaggé (`scoring_v6_ui`), actif seulement pour 2 orgs témoins, affiché uniquement dans le nouveau bloc "Météo du compte" |

**Décision produit déjà actée** (voir mémoire `tohu-scoring-v6`) : le legacy reste la source de vérité tant que V6 n'a pas passé ses tests de référence (`reference_account_v6 = 33`). Aucune bascule d'autorité n'a eu lieu. C'est donc *normal* et *attendu* qu'un compte affiche deux scores différents aujourd'hui — mais rien dans l'UI ne l'explique à l'utilisateur final, d'où la confusion.

---

## Mécanique détaillée — moteur Legacy (`score-batch/index.ts`)

Une seule fonction, deux niveaux de calcul empilés : d'abord un score **personne** par contact, puis un score **compte** agrégé à partir des scores personnes. Tourne en cron (6h) sur toute l'organisation, ou en appel manuel ciblé (ajout de compte, archivage, etc.). Pas de notion de "preuve datée" : tout est recalculé à chaud à partir des tables d'activité, sans conserver de justification individuelle.

### Étage 1 — Score personne (par contact), 5 axes pondérés

`AXIS_WEIGHTS = { confiance: 0.25, satisfaction: 0.25, engagement: 0.20, reciprocite: 0.20, ancrage: 0.10 }` (`score-batch/index.ts:25`). Le score final est une **moyenne pondérée simple**, sans plancher — un axe très faible (ex. Ancrage à 0) ne peut pas faire chuter le total en dessous de ce que les autres axes compensent :

- **Confiance** et **Satisfaction** (50 % du poids total) — **ne sont PAS calculées ici**. Ce sont des nombres produits par un LLM ailleurs (`sync-email-analysis` / `_shared/behavior-analysis.ts`, champs `trust`/`satisfaction`) et simplement *lus* depuis `cognitive_profiles.trust_score`/`satisfaction_score`. **Si ces valeurs n'ont jamais été mesurées, le code applique `?? 50`** (`index.ts:424-425`) : un contact jamais analysé par le LLM se voit donc attribuer une Confiance et une Satisfaction "neutres" de 50/100, indiscernables d'un contact réellement mesuré à 50. `confianceMeasured`/`satisfactionMeasured` distinguent les deux cas en interne mais **cette distinction n'atteint pas le score final** — un 50 par défaut pèse exactement comme un 50 mesuré dans la moyenne pondérée.
- **Engagement** (20 %) — `scoreEngagement()` (`index.ts:74-83`) : compare le rythme d'échange récent (90 derniers jours, réunions comptant 4× un email) à la propre baseline du contact (moyenne sur toute la relation observée), plafonné à 2× la baseline. Une relation de moins de 45 jours est traitée neutre (ratio=1, pas de biais de démarrage). Ajoute un bonus de "richesse" de canal (1/2/3+ canaux → 25/65/100) et de "profondeur" de fil de discussion.
- **Réciprocité** (20 %) — `scoreReciprocite()` (`index.ts:88-92`) : équilibre entre messages envoyés/reçus, atténué selon le type de relation déclaré (une asymétrie Prospect/Client est jugée normale, contrairement à un Partenaire), pondéré aussi par taux de réponse et vitesse de réponse.
- **Ancrage** (10 %) — `scoreAncrage()` (`index.ts:98-103`) : nombre de collaborateurs internes distincts ayant échangé ≥3 messages avec ce contact → barème fixe {0→0, 1→25, 2→60, 3+→100}.

Résultat stocké dans `cognitive_profiles.engagement_score` (le "score personne" affiché partout) + historique mensuel `contact_score_history` + `person_relationship_score_snapshots`. Une **phase** (`growth`/`stagnant`/`decline`) est dérivée du delta vs le score du mois précédent (seuil ±8 points).

### Étage 2 — Score compte, agrégation des scores personnes

Une fois tous les contacts d'un compte scorés, `score-batch` calcule pour ce compte (`index.ts:618-626`) :

- **`engagementComponent`** : moyenne des scores des contacts *engagés ce mois-ci*, pondérée par `(1 + interactions)` — un contact très actif pèse plus qu'un contact silencieux.
- **`contactCoverage`** : `% de contacts du compte ayant eu au moins une interaction ce mois-ci`.
- **`recencyComponent`** : décroissance exponentielle (demi-vie 90 jours) depuis la dernière interaction du compte.
- **Score final** = `engagementComponent×0,55 + contactCoverage×0,25 + recencyComponent×0,20`, arrondi. **Si aucun contact n'est "engagé" ce mois (silence total), le score n'est PAS 0 mais 50** (`index.ts:622-626`, neutre par convention) — la phase passe alors à `'unknown'` pour signaler ce cas.

Stocké dans `account_relationship_score_snapshots` (1 ligne par compte/mois, colonne `score` + composantes détaillées `engagement_component`/`contact_coverage`/`recency_component`). C'est cette table que lisent la liste Comptes et la Home.

En plus du score, ce même passage génère les **recommandations automatiques** (`account_recommendations`) et les **phases compte** (`growing`/`stable`/`declining`) — règles déterministes indépendantes de V6 (compte en tension si phase déclinante, risque de concentration si >70 % des échanges reposent sur un seul contact, etc.).

---

## Mécanique détaillée — moteur V6 (shadow)

V6 empile 4 couches distinctes, chacune dans son propre fichier pur (testé unitairement, aucun accès DB direct) :

### Couche 0 — `scoring.marker_event` : la matière première

Contrairement au legacy qui recalcule tout depuis des statistiques brutes à chaque run, V6 exige d'abord la production d'un **`marker_event`** : un fait daté et sourcé (`evidence_ref`, `observed_at`, texte verbatim ou résumé) rattaché à un identifiant de marqueur fermé (registre C01…A02 / K01…K09 / X01…X03, ex. "S07 = incident grave signalé", "K04 = livrable contractuel en retard"). Ces événements sont produits soit par des **détecteurs déterministes** (`src/services/scoring/detectors.ts`, lisant messages/meetings réels), soit par le **classificateur sémantique LLM** (`supabase/functions/classify-markers`), qui ne fait jamais qu'associer un `marker_id` du registre fermé à une preuve (ou répond "NO_MARKER") — **jamais un chiffre**. C'est la différence de doctrine fondamentale avec le legacy : sans preuve datée, aucune valeur n'est produite (jamais de repli à 50).

### Couche 1 — `calculateDyadScoreCore` : score d'un contact (dyade), 5 axes C/S/E/R/A

Même 5 axes que le legacy dans l'esprit (Confiance/Satisfaction/Engagement/Réciprocité/Ancrage), mais calcul radicalement différent (`calculateDyadScoreCore.ts`) :

- Chaque axe part d'une base neutre **50**, puis chaque `marker_event` applicable à cet axe ajoute ou retranche des points signés (`+`/`−` selon le marqueur), pondérés par 3 facteurs : **volontarité** du geste (subi/semi-volontaire/volontaire — un engagement tenu "sur demande" ne vaut pas la même chose que spontané), **multiplicateur de répétition** (1 occurrence < 2-3 < 4+, la répétition d'un même signal renforce mais avec rendement dégressif), et **décroissance par rang** (`params.decay`) — le marqueur le plus fort d'un axe compte plus que le 2e, qui compte plus que le 3e, etc.
- **Plafond critique S07** : si un incident grave (S07) est détecté, la Satisfaction est plafonnée à 20/100 quel que soit le calcul normal — un seul fait grave suffit à limiter tout l'axe, jamais dilué par ailleurs.
- Score dyade final = moyenne pondérée des 5 axes (mêmes poids C.25+S.25+E.20+R.20+A.10 que le legacy — la forme est la même par construction, la valeur ne l'est pas car les axes eux-mêmes sont calculés autrement).

### Couche 1bis — `buildDyadScoreSnapshot` : fenêtre, cold start, fiabilité

Applique 3 règles que le noyau mathématique ignore volontairement :
- **P5 (cold start)** : si la relation a moins de 30 jours ou moins de 5 épisodes d'échange, **aucun score n'est produit** (`score: null`) — trop tôt pour juger.
- **P7 (verdict)** : même avec un score calculable, un "verdict" n'est autorisé que s'il existe **≥5 marqueurs datés** ; en dessous, le score existe mais reste non qualifié pour une conclusion forte.
- **Fiabilité (0-1)** = `couverture_canal × volume_marqueurs × identité × diarisation`, plafonnée si un canal n'est pas instrumenté (X01). Cette fiabilité pilote ensuite l'affichage (voir plus bas).

### Couche 2 — `calculateAccountWeatherCore` : les 6 cadrans de la Météo compte

Agrège les dyades actives du compte en 6 cadrans, chacun avec sa propre formule (`calculateAccountWeatherCore.ts`) :

1. **Satisfaction** — moyenne des dyades pondérée par *autorité de rôle* (Décideur 1.0 / Influenceur 0.6 / Utilisateur 0.3 / Filtre 0.2), plus les marqueurs K de niveau compte (K03/K06/K07). Plafond dur si K06 actif.
2. **Confiance & réciprocité** — moyenne pondérée autorité de `(Confiance+Réciprocité)/2` des dyades, aucun modificateur K.
3. **Couverture** — `100 × Σautorité(interlocuteurs couverts) / Σautorité(interlocuteurs cibles)` : mesure si les décideurs réels du compte sont *effectivement* en contact, pas juste listés. **Plafonné à une valeur basse si un décideur n'a aucune dyade active du tout** — un compte peut avoir plein de contacts secondaires actifs mais 0 lien avec le vrai décideur, et ce cadran le reflète.
4. **Équilibre** — indice inverse de concentration (HHI) sur la répartition du volume d'échanges entre interlocuteurs : un seul interlocuteur qui porte tout le compte → 0/100, peu importe le volume total.
5. **Ancrage** — barème sur le nombre de porteurs internes actifs {0/1/2/3+ → paliers fixes}, plus marqueurs K05/K08.
6. **Dynamique** — combine 3 sous-scores : *pente* (tendance des 5 autres cadrans sur 30j, interpolée), *silence* (ratio jours-depuis-dernier-contact / cadence habituelle de CE compte, jamais un seuil absolu), *solde* (engagements tenus moins glissés sur 90j). Plafonné si un marqueur K01 (silence anormal) dure plus de 12 mois.

**Score Météo = somme pondérée des 6 cadrans calculables**, avec **redistribution du poids** des cadrans non calculables (`value === null`) sur les cadrans restants — jamais une valeur inventée pour un cadran sans donnée suffisante. C'est ce mécanisme qui explique pourquoi, sur les comptes actuels (rôles décisionnaires non renseignés), les cadrans Couverture/Satisfaction/Confiance restent gris "donnée insuffisante" alors que Équilibre/Ancrage/Dynamique (qui ne dépendent pas de l'autorité de rôle) peuvent parfois se calculer.

### Couche 3 — `buildAccountWeatherSnapshot` + `displayRule` : ce que l'UI a le droit de montrer

La **fiabilité du compte** = le minimum des fiabilités des cadrans "significatifs" (poids ≥15 %) — un seul cadran mal fiabilisé plombe la fiabilité globale, jamais moyennée pour la diluer. Cette fiabilité pilote `displayRule()` (`snapshots.ts:148-153`), qui décide de l'affichage final :
- fiabilité < 0,50 → score grisé, aucun verdict ("donnée insuffisante") ;
- pas assez de marqueurs datés (P7) → idem, même si la fiabilité est correcte ;
- fiabilité entre 0,50 et 0,60 → score affiché en ambre (fiabilité modérée) ;
- fiabilité ≥0,60 et P7 validé → score et verdict affichés normalement.

C'est cette dernière couche, combinée au blocage `decision_role` vide (voir tableau plus haut), qui explique pourquoi la Météo V6 est aujourd'hui **honnêtement absente ou grisée sur la quasi-totalité des comptes** : ce n'est pas un bug d'affichage, c'est la doctrine "jamais de valeur inventée" appliquée strictement à un pipeline dont l'entrée (marqueurs + rôles) est encore trop clairsemée en prod.

---

## Zone par zone : qui affiche quoi, et d'où ça vient

### 1. Page **Liste des Comptes** (`src/account-list/AccountsListPage.tsx`)

Source : `src/account-list/service.ts::getAccountsOverview` → `buildAccountRows` (`src/account-list/mapping.ts:162-163`).

Ordre de repli pour la colonne Score (et pour le tri, le classement en tiers, la carte "Score relationnel global", le graphique 36 mois) :

1. `account_relationship_score_snapshots.score` le plus récent (**legacy**, formule 0,55/0,25/0,20) ;
2. sinon `companies.public_context.relationship_score` (champ statique, rarement à jour) ;
3. sinon moyenne des scores des contacts du compte (`cognitive_profiles.engagement_score`, **legacy niveau personne**, formule 0,25/0,25/0,20/0,20/0,10).

→ **100 % legacy**. Aucune référence à V6 dans cette page.

### 2. **Home** (`src/home/service.ts`, `src/home/priority.ts`)

Même source exactement : `account_relationship_score_snapshots` en priorité, repli sur `relationship_snapshots.engagement_score` / `cognitive_profiles.engagement_score`, agrégée par `aggregateGlobalScore`. Le commentaire en tête de `priority.ts` le dit explicitement : "La Home ne recalcule aucun score relationnel : elle consomme les scores persistés."

→ **100 % legacy**, même chaîne que la liste Comptes. Cohérent entre les deux.

### 3. **Fiche Compte → onglet Relation → bandeau "Où on en est"** (`AccountRelationView.tsx:469-484`)

Affiche `WeatherHero` (`AccountWeatherV6.tsx:244-275`), qui lit **exclusivement** `brain.weather` — c'est-à-dire `account_brain` RPC → `scoring.score_snapshot` (**V6**). Si ce snapshot n'existe pas (cas actuel pour la quasi-totalité des comptes, cf. tableau ci-dessus), `WeatherHero` retourne `null` et rien ne s'affiche — pas de repli sur le score legacy.

### 4. **Fiche Compte → section "Météo du compte"** (`AccountWeatherV6.tsx::WeatherSection`, appelée `AccountRelationView.tsx:684`, seulement si `v6Enabled` — flag `scoring_v6_ui`)

6 cadrans (`d_confiance_recip`, `d_satisfaction`, `d_dynamique`, `d_couverture`, `d_equilibre`, `d_ancrage`), calculés par `calculateAccountWeatherCore.ts` (frontend) à partir de `scoring.marker_event`. **100 % V6**, sans lien avec le score de la liste Comptes.

### 5. **Fiche Compte → `service.ts::getAccountDetail` → objet `relationship`** (`service.ts:297-316`)

Calcule un objet `relationship.score` = `account_relationship_score_snapshots.score` le plus récent, **legacy**, avec `engagementComponent`/`recencyComponent`/`contactCoverage` détaillés. **Ce champ est chargé mais n'est actuellement affiché nulle part dans `AccountRelationView.tsx`** (vérifié : seul `relationship.totalInteractions` est utilisé pour la lecture stratégique). Code mort côté affichage — mais toujours calculé, toujours dans le payload, donc un futur composant pourrait le réafficher par erreur à côté de la Météo V6 sans que personne ne s'en aperçoive.

### 6. **Organigramme (OrgGrid) dans la fiche Compte** (`AccountRelationView.tsx:648`)

Affiche `person.score` par personne — c'est `cognitive_profiles.engagement_score` (**legacy**, niveau personne, formule à 5 axes C/S/E/R/A pondérée 0,25/0,25/0,20/0,20/0,10, où C et S viennent de nombres produits par un LLM).

### 7. **Fiche Personne** (`src/person-detail/`, `src/person-list/`)

D'après `mapping.ts`/`service.ts` de ces dossiers (mêmes patterns que le compte) : score legacy = `cognitive_profiles.engagement_score`/`trust_score`/`satisfaction_score`. Le calcul V6 équivalent (`calculateDyadScoreCore`, référence 55) existe côté `src/services/scoring/` mais n'a pas d'UI dédiée confirmée en dehors du shadow.

---

## Pourquoi les nombres divergent concrètement

1. **Formules différentes.** Legacy compte = 3 composantes (engagement/couverture/récence). V6 compte = 6 cadrans avec pondération par autorité de rôle, plafonds par marqueurs, HHI de répartition. Même compte, même "vérité terrain" → deux nombres qui n'ont aucune raison de coïncider, ce ne sont pas deux mesures de la même chose avec un bug d'arrondi, ce sont deux définitions différentes de "santé du compte".
2. **Sources de données différentes.** Legacy s'appuie sur des stats d'activité + deux nombres produits par un LLM (`trust_score`/`satisfaction_score`, avec un défaut `?? 50` si absent — donc parfois un score "gonflé" artificiellement à 50 sans qu'aucune donnée réelle ne le justifie). V6 s'appuie uniquement sur des `marker_event` avec preuve et date — s'il n'y a pas de preuve, il n'y a pas de valeur, jamais de 50 par défaut.
3. **Couverture radicalement différente.** V6 est quasi vide en prod (`scoring.score_snapshot` vide pour la quasi-totalité des comptes) car `account_contact_roles.decision_role` n'est renseigné nulle part → certains cadrans V6 (Couverture, Confiance, Satisfaction) ne peuvent pas se calculer du tout, s'affichent en gris "donnée insuffisante". Sur ces comptes, la Météo est donc soit absente (bandeau "Où on en est"), soit partiellement grisée (section Météo), pendant que la liste Comptes affiche un score legacy plein et complet pour le même compte.
4. **Aucun repli croisé entre les deux moteurs.** `WeatherHero` ne retombe jamais sur le score legacy si V6 est vide ; la liste Comptes ne consulte jamais V6. Il n'existe donc aucun mécanisme qui les ferait converger ou qui expliquerait l'écart à l'utilisateur.
5. **`relationship.score` (legacy) reste chargé dans le payload de la fiche Compte mais n'est plus affiché** — c'est un vestige, pas un danger immédiat, mais une source d'incohérence si quelqu'un le raccroche à un composant un jour sans le documenter.

---

## Ce qu'il faudrait décider pour "mettre de l'ordre" (pistes, pas encore fait)

Ces points sont des options à trancher côté produit, pas des faits déjà en place :

- **Nommer explicitement les deux scores dans l'UI** tant que V6 n'est pas autoritaire (ex. libellé "Score relationnel (legacy)" sur la liste Comptes vs "Météo du compte (V6 · shadow)" sur la fiche) plutôt que de laisser deux nombres sans étiquette.
- **Débloquer la couverture V6** : renseigner `account_contact_roles.decision_role` (aujourd'hui vide partout) est le blocage racine qui empêche V6 de produire un score sur la quasi-totalité des comptes.
- **Décider du sort de `relationship.score`** dans `service.ts` : le supprimer du payload s'il n'est plus utilisé, ou le réafficher intentionnellement avec un libellé clair.
- **Ne pas basculer l'autorité** (liste Comptes / Home) vers V6 avant que `reference_account_v6 = 33` soit atteint sur les tests de référence — c'est la garde-fou déjà décidée pour éviter un score "moins fiable" en prod du jour au lendemain.

---

## Fichiers clés (référence rapide)

- Legacy calcul compte : [supabase/functions/score-batch/index.ts:625](supabase/functions/score-batch/index.ts#L625)
- Legacy calcul personne : [supabase/functions/score-batch/index.ts:25](supabase/functions/score-batch/index.ts#L25) (`AXIS_WEIGHTS`)
- Legacy stockage compte : table `account_relationship_score_snapshots`
- Legacy stockage personne : `cognitive_profiles.engagement_score/trust_score/satisfaction_score`
- V6 calcul compte (frontend) : [src/services/scoring/calculateAccountWeatherCore.ts](src/services/scoring/calculateAccountWeatherCore.ts)
- V6 calcul compte (edge, miroir) : [supabase/functions/_shared/scoring-v6/calculateAccountWeatherCore.ts](supabase/functions/_shared/scoring-v6/calculateAccountWeatherCore.ts)
- V6 stockage : schéma `scoring` (`scoring.marker_event`, `scoring.score_snapshot`)
- Liste Comptes : [src/account-list/mapping.ts:162](src/account-list/mapping.ts#L162)
- Home : [src/home/service.ts:200](src/home/service.ts#L200), [src/home/priority.ts:4](src/home/priority.ts#L4)
- Fiche Compte / bandeau Météo : [src/account-detail/AccountWeatherV6.tsx](src/account-detail/AccountWeatherV6.tsx)
- Fiche Compte / objet `relationship` (legacy, non affiché) : [src/account-detail/service.ts:297](src/account-detail/service.ts#L297)
