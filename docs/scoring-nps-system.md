# Système de calcul du score relationnel et du « NPS » — état des lieux complet

Document de référence, généré à partir du code réellement déployé (pas d'hypothèse). Objectif : donner tous les éléments pour décider si des ajustements moteur sont nécessaires.

Dernière mise à jour : score-batch v21, 2026-08-26 — refonte complète du score PERSONNE en modèle à 5 axes (Confiance/Satisfaction/Engagement/Réciprocité/Ancrage), remplaçant la V57.

---

## 1. Clarification terminologique — il n'y a pas de vrai NPS

Le terme « NPS » (Net Promoter Score) est utilisé à deux endroits différents dans Tohu, et **aucun des deux n'est un NPS de satisfaction client déclarée**. C'est le point le plus important à comprendre avant tout le reste.

| Où | Ce que c'est vraiment | Formule NPS classique appliquée à… |
|---|---|---|
| Bandeau « NPS compte (roll-up) » sur la fiche compte (`AccountDetailPage.tsx`, `V48AccountViews.tsx`) | Le **score relationnel du compte lui-même**, redécoupé en 3 bandes | Seuils : Promoteur ≥70, Passif 50-69, Détracteur <50 |

> Il existait aussi une table `nps_snapshots`, calculée par `score-batch` selon la vraie formule NPS mais **jamais lue par aucune page**. Retirée en v19 (voir §2.5 et §6) : code mort supprimé, la table reste en base avec son historique gelé mais n'est plus alimentée.

Le code lui-même documente cette distinction : `src/home/types.ts` porte le commentaire *« Bandes du score relationnel (doctrine anti-NPS) »*, et `V48AccountViews.tsx` affiche explicitement : *« Ce score décrit la solidité du réseau relationnel, pas la satisfaction déclarée. »*

**Conséquence pratique** : personne n'a jamais répondu à un sondage NPS dans Tohu. Ce qu'on appelle NPS est un proxy calculé à partir de 5 axes mesurés sur les échanges réels (emails, réunions) — voir §2. Depuis le passage au modèle 5 axes (v21), le score personne est systématiquement accompagné d'une **interprétation textuelle déterministe** (`axis_interpretation`, ex. *« Relation intermédiaire, portée par la réciprocité. Le principal point de fragilité vient de l'ancrage organisationnel (25/100). »*) — le score n'est donc plus jamais affiché seul, conformément à l'exigence « ne jamais se contenter de dire score:80 ».

---

## 2. Le moteur unique : `score-batch` (edge function Supabase)

**Un seul moteur calcule tout**, jamais le frontend. Toutes les pages (Home, Comptes, Personnes, fiche compte, fiche personne) ne font que *lire* des valeurs déjà persistées par `score-batch`. C'est une règle de conception explicite (doctrine « zéro hallucination ») : si `score-batch` n'a pas encore tourné, l'UI affiche `null` / « Données insuffisantes », jamais une valeur recalculée localement à la volée à partir d'une autre formule.

### 2.1 Déclenchement

| Déclencheur | Portée | Profondeur historique |
|---|---|---|
| Cron toutes les 6h (`x-cron-secret`) | Tous les contacts trackés de toutes les orgs | Mois courant uniquement (fenêtre glissante 6 mois pour `contact_score_history`) |
| Ajout d'une personne (`trackPersonCandidate`) | 1 contact | `deepBackfill` — historique réel complet, **sans plafond** (jusqu'à la 1ère interaction réelle) |
| Ajout d'un compte (`trackCandidates`) — **corrigé aujourd'hui** | Toute l'org | `deepBackfill` org entier |
| Archivage/désarchivage d'un compte ou d'une personne — **ajouté aujourd'hui** | Toute l'org | Mois courant (recalcul rapide, pas de backfill) |
| Appel manuel `deepBackfill:true` | 1 org (+1 contact optionnel) | Historique réel complet, sans plafond métier |
| Appel manuel `forceRecompute:true` | 1 org | Recalcule même les mois déjà couverts (upsert, ne supprime jamais) |

**Profondeur illimitée (v19)** : le `deepBackfill` remontait auparavant jusqu'à 36 mois maximum, plafond arbitraire. Retiré — la reconstruction remonte désormais jusqu'à la toute première interaction réelle du contact (premier email ou réunion synchronisé), quelle que soit son ancienneté : dès qu'on a les emails, on a le droit de les compter. Un garde-fou purement technique (600 mois ≈ 50 ans) protège seulement contre une donnée de date corrompue, jamais contre une relation authentiquement ancienne.

### 2.2 Formule du score PERSONNE — modèle 5 axes (v21, remplace la V57)

Le score personne a été entièrement refondu selon un document de référence à 5 axes fourni par l'équipe produit. Il ne mesure plus seulement la quantité d'échanges, mais la qualité, l'équilibre et la résilience de la relation. **Moyenne pondérée pure, sans règle plancher** (contrairement à la V57) — le document de référence donne un exemple chiffré (92/88/76/81/40 → 80,4) où le résultat dépasse largement l'axe le plus faible : un point de fragilité isolé (ex. ancrage) ne doit pas noyer une relation par ailleurs solide.

```
Score = Confiance×0,25 + Satisfaction×0,25 + Engagement×0,20 + Réciprocité×0,20 + Ancrage×0,10
```

**a) Confiance (25%) — « Peut-on réellement compter l'un sur l'autre ? »**
Mesure la fiabilité relationnelle : engagements tenus/non tenus, réponses aux demandes importantes, continuité, respect des échéances, ruptures inexpliquées. **Nécessite de lire le contenu réel des échanges**, pas seulement leurs métadonnées — extrait par IA (voir §2.3), jamais calculé à partir du seul volume d'emails. `cognitive_profiles.trust_score` = signal brut mesuré ; si l'IA n'a pas encore analysé ce contact, le composite utilise une valeur neutre (**50**, jamais fabriquée comme "réelle") — voir `confianceMeasured` en §3.

**b) Satisfaction (25%) — « Les interactions se déroulent-elles positivement ? »**
Mesure la qualité perçue : retours positifs, remerciements, validations d'un côté ; frustrations, désaccords, objections récurrentes de l'autre. Distincte de l'activité (un contact très actif peut être mécontent). Même mécanisme IA que Confiance (`cognitive_profiles.satisfaction_score`), même repli neutre à 50 tant que non mesuré.

**c) Engagement (20%) — « La relation est-elle réellement active ? »**
```
périodesObservées   = ancienneté_jours / 90
baseline            = totalInteractions / périodesObservées     (rythme moyen sur toute la relation)
rythmeRécent        = emailsLast90j + meetingsLast90j×4
ratio                = rythmeRécent / baseline                  (neutre=1 si relation <45j, pas encore de baseline fiable)
composanteBaseline  = ratio≤1 ? ratio×60 : min(100, 60+(ratio−1)×40)
engagement = composanteBaseline×0,70 + richesseCanaux×0,15 + profondeurFil×0,15
```
Contrairement à l'ancienne "intensité" (seuil absolu : 4 emails/mois = max), l'engagement se compare désormais à **sa propre baseline** — 20 échanges avec quelqu'un contacté 2×/mois est un signal fort ; 20 échanges avec quelqu'un contacté quotidiennement ne l'est pas (logique explicitement demandée dans le document de référence).

**d) Réciprocité (20%) — « Les deux entretiennent-ils la relation ? »**
```
asymétrie  = |ratio_initiation − 0,5| × 2
poidsAsym  = 0,35 si type de relation structurellement asymétrique (Prospect/Client/Fournisseur/Investisseur), sinon 0,60
réciprocite = max(0,40, 1 − asymétrie×poidsAsym)×0,50 + tauxRéponse×0,30 + tempsRéponseNormalisé×0,20
```
Nuancée selon `person_settings.relationship_type` — une asymétrie commercial↔prospect est normale, une asymétrie partenaire↔partenaire l'est moins (demandé explicitement : *« ne pas rechercher artificiellement un équilibre parfait »*).

**e) Ancrage (10%) — « La relation dépasse-t-elle une seule personne ? »**
```
porteurs = nombre de membres internes distincts avec ≥3 messages échangés avec ce contact (tout l'historique, pas juste 90j)
ancrage = 0 porteur→0, 1→25, 2→60, 3+→100
```
Mesure le risque *bus factor* : une excellente relation interpersonnelle qui dépend d'un seul individu est fragile pour l'organisation. **Entièrement nouveau** — n'existait pas avant v21, le moteur ne comparait jamais les relations entre elles à travers les différents membres de l'équipe. Détection basée sur `communication_messages.metadata.user_id` (couverture ~25% des messages sur Webfityou au moment du déploiement — voir §6.2) ; le propriétaire déclaré du contact compte toujours comme au moins 1 porteur pour ne jamais afficher 0 par simple absence de métadonnée.

Longévité (durée + continuité, `scoreLongevite`) reste calculée pour affichage (ancienneté en jours) mais ne pèse plus dans le composite — elle est en partie diffuse dans Confiance (continuité) et Engagement (baseline sur toute la relation).

**Phase** (growth/stagnant/decline) : delta ≥ +8 pts → growth ; delta ≤ −8 pts **et** score ≤ 70 → decline ; sinon stagnant. Mécanisme inchangé, appliqué au nouveau composite.

### 2.3 Extraction IA de Confiance/Satisfaction (`_shared/behavior-analysis.ts`)

`score-batch` reste un pur calcul — il ne fait **aucun appel IA lui-même**. Confiance et Satisfaction sont extraites en amont par `sync-email-analysis`, dans le **même appel LLM** qui produit déjà le profil de style de communication (rythme, registre, tonalité…) — pas un appel supplémentaire, donc pas de coût additionnel par message. Le modèle reste `google/gemini-3.1-flash-lite` (inchangé).

- Le prompt impose : `"status":"insufficient"` si aucune preuve concrète (engagement tenu/non tenu pour Confiance ; tonalité positive/négative explicite pour Satisfaction) — jamais déduit du seul volume d'échanges.
- Résultat persisté dans `cognitive_profiles.trust_score` / `satisfaction_score` (+ `_reasoning`, `_analyzed_at`), lu (jamais recalculé) par `score-batch` au run suivant.
- Le corps des emails reste **transitoire, jamais stocké** (`communication_messages.body_text` toujours `null`) — l'extraction Confiance/Satisfaction ne change rien à cette protection (voir §6.2.4).
- Se déclenche : au cron normal (analyse des contacts prioritaires), à l'ajout d'une personne (relecture ciblée automatique, voir §2.1), et à l'ingestion manuelle de transcript (`ingest-transcript`, même pipeline partagé).

### 2.4 Formule du score compte (agrégation) — inchangée par ce chantier

Le score compte n'utilise **pas** le modèle 5 axes (le document de référence concerne explicitement le score PERSONNE) — il continue d'agréger les scores personne composites des contacts **engagés** du compte (ceux qui ont eu au moins 1 interaction ce mois-là), formule inchangée :

```
couvertureContacts = contacts engagés / total contacts actifs du compte
composanteEngagement = moyenne pondérée des scores des contacts engagés (poids = 1 + nb interactions de chacun)
composanteRécence = exp(−ln(2)/90 × joursDepuisDernièreInteraction) × 100

score compte = round(clamp(
    composanteEngagement/100 × 0.55
  + couvertureContacts/100    × 0.25
  + composanteRécence/100     × 0.20
) × 100)
```
Si aucun contact engagé mesuré ce mois-là → score neutre = **50** (jamais 0 — l'absence de mesure n'est pas un échec, c'est une inconnue).

Phase compte : mêmes seuils que la phase personne (±8 pts), demi-vie de récence fixe à 90 jours.

### 2.5 Le calcul NPS — retiré en v19 (code mort)

`score-batch` calculait un vrai indicateur NPS (`%promoteurs − %détracteurs`, formule standard, score ≥70/≤50) par organisation et par jour, écrit dans `nps_snapshots`. Personne ne le lisait jamais côté frontend (vérifié : aucun `.from('nps_snapshots')` dans `src/`). Supprimé du moteur en v19 : moins de calcul, moins d'écriture inutile à chaque run. La table existe toujours en base avec son historique (gelé), mais n'est plus alimentée — à supprimer par migration si elle doit vraiment disparaître, ou à réactiver si un vrai usage NPS est décidé un jour (voir §6).

---

## 3. Où chaque valeur va (tables) et qui les lit

| Table | Écrite par | Contenu | Lue par |
|---|---|---|---|
| `cognitive_profiles` | score-batch (composite, upsert, mois courant) + sync-email-analysis (`trust_score`/`satisfaction_score`, upsert) | Score personne courant + 5 sous-scores + signaux IA bruts | Home (repli), account-list (repli), person-detail |
| `contact_score_history` | score-batch (upsert, tous les mois backfillés) | Historique mensuel du score personne + 4 sous-scores composites (`score_confiance/satisfaction/engagement/ancrage`, `score_reciprocite`) | account-list (graphe portefeuille), person-list |
| `relationship_snapshots` | score-batch (upsert) | Score personne + tendance, snapshot mensuel | Home (tendance 30j, contactSnapshots) |
| `person_relationship_score_snapshots` | score-batch (insert, dédupliqué/jour) | Score personne détaillé + 5 axes + `ancrage_carriers` + `axis_interpretation` (roll-up fiche personne) | Fiche personne |
| `account_relationship_score_snapshots` | score-batch (insert — jamais d'upsert) | Score compte mensuel (formule inchangée, §2.4) | account-list, account-detail, Home (`accountScores`) |
| `account_recommendations` / `person_recommendations` | score-batch (insert) | Recommandations déterministes (+ nouvelle catégorie `ancrage` : « Élargir les porteurs de la relation ») | Fiches compte/personne |
| `nps_snapshots` | **plus personne depuis v19** (historique gelé) | NPS proxy org/jour | Personne (jamais lue) |

`account_relationship_score_snapshots` utilise un **insert simple, jamais un upsert** : chaque run de cron ajoute une nouvelle ligne (pas de déduplication par jour). C'est voulu pour l'historique fin, mais ça veut dire que le volume croît vite (4 runs/jour × nb de comptes). Non problématique aujourd'hui (~700-1000 lignes/org), mais à surveiller si un org grossit beaucoup — le plafond serveur PostgREST de 1000 lignes/requête (voir §5) redeviendrait un risque.

`person_relationship_score_snapshots` est **dédupliqué par jour** (une seule ligne par contact/jour) : si `score-batch` est rejoué plusieurs fois le même jour (ex. `forceRecompute` pour vérifier un correctif), les nouvelles valeurs 5 axes atterrissent bien dans `cognitive_profiles`/`contact_score_history` (upsert, toujours à jour), mais le snapshot du jour n'est pas remplacé — `ancrage_carriers`/`axis_interpretation` (uniquement sur cette table) peuvent donc rester temporairement figés sur une valeur antérieure au sein d'une même journée. Sans impact le lendemain (nouveau jour = nouvelle ligne).

### 3.1 Seuils d'affichage — ils diffèrent selon la page

| Surface | Seuils | Fichier |
|---|---|---|
| Home (`relationLevel`) | Solide ≥70 / Intermédiaire 50-69 / Fragile <50 | `src/home/types.ts` |
| Comptes liste (`accountTier`) | Stables ≥70 / À traiter 60-69 / Sous tension 50-59 / Critique <50 | `src/account-list/mapping.ts` |
| Bandeau « NPS » fiche compte | Promoteur ≥70 / Passif 50-69 / Détracteur <50 | `AccountRelationView.tsx` |

Les bornes hautes (70/50) sont cohérentes partout. La liste Comptes a une bande intermédiaire supplémentaire (50-59 / 60-69) que Home n'a pas — ce n'est pas une incohérence de calcul, juste un affichage plus granulaire à cet endroit.

---

## 4. Le problème que tu as soulevé — et le correctif appliqué aujourd'hui

### 4.1 Constat avant correctif

« Supprimer » une personne ou un compte dans Tohu n'a **jamais été une vraie suppression** — c'est un archivage réversible (`archived_at` sur `person_settings` / `account_settings`). Le moteur `score-batch`, lui, ne filtrait que sur `contacts.is_tracked` / `companies.is_tracked`, qui ne changent jamais à l'archivage. Résultat vérifié dans le code :

- Une personne archivée continuait d'alimenter le score de son compte et le NPS agrégé.
- Un compte archivé continuait de recevoir un score à chaque cron.
- **Home spécifiquement** ne filtrait même pas les comptes archivés côté lecture (contrairement à la liste Comptes, qui les excluait déjà côté affichage) → le score global affiché sur Home incluait des comptes qu'on ne voyait plus nulle part ailleurs.
- Le graphe « Évolution du scoring relationnel » de `/app/accounts` incluait lui aussi l'historique des comptes archivés.
- Ajouter un compte ne déclenchait aucun recalcul immédiat (contrairement à l'ajout d'une personne) : il fallait attendre jusqu'à 6h pour voir son score apparaître.

### 4.2 Correctif déployé (score-batch v18 + frontend)

1. **`score-batch`** exclut désormais explicitement tout contact dont `person_settings.archived_at` est renseigné, et tout compte dont `account_settings.archived_at` est renseigné — à la source, avant tout calcul. Aucune nouvelle ligne n'est produite pour une entité archivée, dans aucune des tables du §3.
2. **Home** (`home/service.ts`) filtre maintenant en temps réel (lecture directe de `account_settings`/`person_settings`, indépendamment de la fraîcheur du dernier passage moteur) — le score global ne peut plus jamais compter une entité archivée, même avant le prochain recalcul.
3. **Graphe portefeuille** (`account-list/service.ts`, `buildPortfolioSeries`) exclut désormais l'historique des comptes archivés.
4. **Ajout d'un compte** déclenche désormais un recalcul immédiat + un `deepBackfill` (même comportement que l'ajout d'une personne).
5. **Archivage/désarchivage** (compte ou personne) déclenche un recalcul immédiat de l'organisation, pour que le score du compte concerné se mette à jour sans attendre le cron.

### 4.3 Validation en base (donnée réelle, pas simulée)

Sur l'organisation Webfityou, avant correctif, 2 comptes archivés (« Bigmamma », « Ulysse Bda ») pesaient encore dans la moyenne. Calcul vérifié :

- **Avant** (9 comptes, dont 2 archivés à tort inclus) : score global ≈ **42**
- **Après** (7 comptes réellement suivis) : score global ≈ **48**

Test en conditions réelles : archivage du compte « Bigmamma » via SQL identique à l'action produit, puis rejeu de `score-batch` → aucune nouvelle ligne `account_relationship_score_snapshots` produite pour ce compte (confirmé), les 3 autres comptes actifs se sont recalculés normalement.

---

## 5. Contexte : le bug de pagination corrigé juste avant (v16-v17)

Sans lien direct avec l'archivage, mais qui affectait la fiabilité générale du score : le projet Supabase plafonne toute requête PostgREST à **1000 lignes côté serveur**, en ignorant silencieusement tout `.limit()` client plus élevé. `score-batch` récupérait donc parfois un sous-ensemble arbitraire (sans tri) des emails/réunions d'un contact pour calculer son score. Corrigé par pagination explicite (`fetchAllPages`, boucle sur `.range()`) dans `score-batch` et dans les pages Comptes/Personnes qui lisent `contact_score_history`.

---

## 6. Pistes d'ajustement moteur

### 6.1 Traité (v19-v21)

1. ~~**`nps_snapshots` n'est lu nulle part.**~~ Calcul et écriture retirés de `score-batch` (§2.5). La table reste en base (historique gelé) mais n'est plus alimentée — à supprimer par migration si elle doit vraiment disparaître.
2. ~~**Plafond arbitraire de 36 mois sur le `deepBackfill`.**~~ Retiré : la reconstruction remonte désormais jusqu'à la toute première interaction réelle, sans limite métier.
3. ~~**`person-detail/mapping.ts`** contenait un repli sur des champs `row.nps` / `row.nps_score` / `row.relationship_score` / `row.value` qui n'existaient dans aucune table réellement interrogée.~~ Retirés — `legacyScore()` ne garde que les deux champs réels (`score`, `engagement_score`).
4. ~~**Fenêtre d'intensité trop courte (30j), surpénalisait les creux ponctuels.**~~ Élargie à 90j en v20 — puis l'axe Intensité lui-même a été remplacé par Engagement (baseline-relative, v21, voir §2.2c), qui règle le même problème plus en profondeur.
5. ~~**Découverte 2 ans (`DISCOVERY_LOOKBACK_DAYS`) vs relecture ciblée illimitée manuelle uniquement.**~~ La relecture ciblée (tous les échanges réels avec un contact, sans limite de temps, via recherche Gmail/Outlook dédiée) se déclenche désormais automatiquement à l'ajout d'une personne (`trackPersonCandidate`, `person-list/service.ts`), au lieu de dépendre d'un clic manuel « relire » sur la fiche. Le corps des emails n'est toujours jamais stocké (`body_text: null`, voir 6.2.4) — seul le déclenchement devient automatique, pas la nature des données conservées. La fenêtre de découverte générale (2 ans, pour détecter de *nouveaux* contacts non encore suivis) reste inchangée.
6. ~~**Le score PERSONNE V57 (Intensité/Réciprocité/Récence) ne mesurait que l'activité, jamais la fiabilité, la satisfaction ou la résilience organisationnelle de la relation.**~~ Remplacé en v21 par le modèle à 5 axes (Confiance/Satisfaction/Engagement/Réciprocité/Ancrage, voir §2.2) fourni par l'équipe produit — refonte complète : nouveau pipeline IA (Confiance/Satisfaction), nouvelle logique de détection de porteurs internes (Ancrage), interprétation textuelle déterministe systématique. Validé sur donnée réelle (Webfityou) : cognitive_profiles/contact_score_history/person_relationship_score_snapshots recalculés avec succès, exemple vérifié (Maxime Weinstein) : Confiance=50 (neutre, IA pas encore passée), Satisfaction=50 (neutre), Engagement=46, Réciprocité=64, Ancrage=25 (1 porteur détecté) → composite 50, cohérent avec la formule pondérée.

### 6.2 Encore à trancher

Ces points demandent une décision produit, pas juste un bugfix :

1. **Le mot « NPS » dans l'UI est trompeur.** C'est le score relationnel rebandé, pas une satisfaction déclarée. À clarifier dans le libellé produit si des clients/prospects voient ce terme (risque de malentendu commercial : un vrai NPS suppose une réponse humaine à une question, pas un calcul d'emails).
2. **Duplication de la formule compte.** Le calcul compte (0.55/0.25/0.20, §2.4) existe en **deux implémentations séparées** : en TypeScript dans `score-batch` et en SQL dans la fonction `account_health_monthly`. Non affecté par la refonte du score personne (v21) — mais désormais le compte agrège des scores personne 5 axes sans lui-même refléter cette logique (le score compte reste une moyenne pondérée engagement/couverture/récence, pas de Confiance/Satisfaction/Ancrage au niveau compte). Si l'une évolue sans l'autre, les deux vues du même compte peuvent diverger silencieusement. `account_health_monthly` ne filtre pas non plus les contacts archivés.
3. **Cas limite découvert pendant la validation** : un compte dont **tous** les contacts sont archivés (mais qui n'est pas lui-même archivé) n'obtient plus aucune nouvelle ligne de score (`totalContacts === 0` après filtrage → skip) — son score reste gelé sur la dernière valeur connue plutôt que d'être marqué comme « non mesurable ». Rare, mais possible.
4. **Stockage du corps des emails — refusé tel quel, décision volontairement non prise seul.** Le pipeline capture déjà le corps des emails de façon transitoire pour l'analyse IA (y compris pour Confiance/Satisfaction depuis v21), mais ne le persiste jamais (`communication_messages.body_text` est écrit `null` sur chaque ligne, avec un flag `analyzed_without_body_storage: true` explicite dans le code). Il a été redemandé (lors de la refonte 5 axes) de retirer cette limite pour donner plus de contexte à l'IA. Toujours non fait : stocker durablement la correspondance de tiers (les interlocuteurs, pas seulement l'utilisateur Tohu) est une décision de conformité à fort impact et difficile à annuler, qui dépasse un simple choix d'ingénierie — à trancher explicitement, idéalement avec un avis juridique/DPO, pas via une instruction ponctuelle.
5. **Historique illimité = coût qui grandit avec l'ancienneté réelle des mailboxes.** Un contact avec 8 ans d'emails déclenche désormais ~96 mois de reconstruction au lieu de 36 lors d'un `deepBackfill`, et la relecture ciblée automatique (§6.1.5) ajoute un appel d'analyse IA à chaque nouvelle personne trackée. Sans impact aujourd'hui (volumes faibles), mais à surveiller si le portefeuille grossit — coût LLM et temps d'exécution grandissent tous les deux avec le nombre de personnes ajoutées.
6. **Couverture Ancrage limitée par les métadonnées existantes.** La détection de porteurs (§2.2e) s'appuie sur `communication_messages.metadata.user_id`, renseigné sur environ 25% des messages de Webfityou au moment du déploiement (les messages ingérés par certaines voies plus anciennes ne portent pas ce champ). L'axe reste fiable pour du multi-porteur détecté positivement (le signal existe vraiment quand il apparaît), mais peut sous-compter des porteurs réels pour des messages plus anciens — s'améliore naturellement au fil des nouvelles synchronisations. Le repli « propriétaire du contact = au moins 1 porteur » évite un faux 0, pas un sous-comptage.
7. **`person_relationship_score_snapshots` dédupliqué par jour retarde `ancrage_carriers`/`axis_interpretation` en cas de rejeu same-day.** Voir §3 — sans impact le lendemain, mais un `forceRecompute` lancé plusieurs fois le même jour pour vérifier un correctif ne rafraîchit pas ces deux champs précis avant minuit (le score et les 5 sous-scores, eux, sont toujours à jour via `contact_score_history`/`cognitive_profiles`).
