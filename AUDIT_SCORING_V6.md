# AUDIT_SCORING_V6 — État réel du scoring vs spécification canonique V6

> **Audit seul. Aucun poids / formule / seuil / marqueur / priorité modifié.**
> Comparaison du code réel (branch main) à la spec V6.0 (14/09/2026).
> Sources : lecture code + inspection base (MCP `tohu-bohu`). Date : 2026-09-14.
>
> **Conclusion d'entrée (à lire avant tout) :** l'architecture V6 fondée sur des
> **marqueurs datés** (registre C01…A02 / K01…K09 / X01…X03, `marker_event`,
> paliers, décroissance, répétition, autorité, `params_version` /
> `registry_version`, Météo à 6 cadrans) **n'existe pas dans le code**. Le
> scoring actuel est un **modèle statistique + LLM** différent, qui partage
> avec la V6 *le nom des axes et quelques poids* mais **pas la mécanique**. Il
> viole plusieurs invariants absolus (notamment « jamais 50 par défaut » et
> « aucun chiffre LLM libre »). Rien n'est corrigé ici.

---

## A. Inventaire de tous les scores existants

| Nom UI | Nom technique | Fichier | Versionné | Preuves/traçabilité | LLM ? | Conforme V6 | Réellement utilisé |
|---|---|---|---|---|---|---|---|
| Score personne (dyade) | `cognitive_profiles.engagement_score`, `person_relationship_snapshots.score` | `score-batch` `computeScore` | `model_version` string seul | non (aucun marker_id) | **partiel** (Confiance/Satisf = LLM) | **Non** | oui |
| Axe Confiance | `confiance_score` (= `cognitive_profiles.trust_score`) | `_shared/behavior-analysis.ts` (extraction) → `score-batch` | non | evidence LLM citée, mais le **nombre** est LLM | **oui** | **Non** | oui |
| Axe Satisfaction | `satisfaction_score` | idem | non | idem | **oui** | **Non** | oui |
| Axe Engagement | `engagement_score` (axe) | `score-batch` `scoreEngagement` | non | stats seules, pas de marqueur | non | **Non** (pas E01–E05) | oui |
| Axe Réciprocité | `reciprocity_score` | `score-batch` `scoreReciprocite` | non | stats | non | **Non** (pas R01/R02) | oui |
| Axe Ancrage | `ancrage_score` | `score-batch` `scoreAncrage` | non | compteur porteurs | non | Barème identique V6, mais pas de marqueur | oui |
| Score compte (« Météo »/« Santé ») | `account_relationship_score_snapshots.score` | `score-batch` (agrégation compte) | `model_version='account-relationship-score-v1'` | non | non | **Non** (3 composantes, pas 6 cadrans) | oui |
| Couverture décideur | `decision_maker_coverage` | `score-batch` | non | non | non | proche « Couverture » mais **hors score** (facteur de risque) | oui (affiché) |
| Risque concentration | `concentration_risk` | `score-batch` | non | non | non | inverse d'« Équilibre » mais **hors score** | oui (affiché) |
| Longévité | `sl` (`scoreLongevite`) | `_shared/relationship-longevity.ts` | non | dates | non | hors V6 | **calculé mais NON utilisé dans le score** |
| Confiance/fiabilité (personne) | `confidence` | `score-batch` `computeScore` | non | heuristique | non | **Non** (pas la formule fiabilité V6) | oui (affiché) |
| Confiance/fiabilité (compte) | `confidence` | `score-batch` | non | heuristique | non | **Non** | oui |
| Priorité recommandations | `account_recommendations.priority` / `person_recommendations.priority` | `score-batch`, `account-strategic-reading` | non | non | partiel | **Non** (échelles hétérogènes) | oui |
| Priorité signaux veille | `company_signals.priority` (texte `high/medium/info`) | `monitor-company-news` `priorityFor` | non | non | non | **Non** (texte, jamais lu par l'UI) | **non lu par l'UI** |
| Profil comportemental (posture, 6+4 axes) | `cognitive_profiles` axes | `behavior-analysis.ts` | `profile_version` | evidence LLM | oui | conforme §27 (**hors score**) | oui (coaching) |
| Score de pertinence (nouveau) | `account-ranking.ts` | — | — | — | — | **spéc. seule, NON implémenté** | non |

---

## B. Architecture réelle actuelle

```
emails/réunions (métadonnées ; corps jamais stocké)
   │
   ├─(cron sync-email-analysis)→ LLM behavior-analysis → cognitive_profiles
   │        • trust_score, satisfaction_score      = NOMBRES 0-100 DÉCIDÉS PAR LE LLM
   │        • posture (rythme, argumentation, …)    = profil, HORS score (conforme)
   │        • account_relation_hint                 = catégorie compte (pondérée)
   │        + person_key_moments / commitments      = mémoire (voir M2)
   │
   └─(cron score-batch, pur calcul, aucun LLM)
            PERSONNE : Confiance=trust??50 · Satisfaction=satisf??50
                       Engagement=f(stats) · Réciprocité=f(stats) · Ancrage=f(porteurs)
                       final = C·.25+S·.25+E·.20+R·.20+A·.10   → cognitive_profiles / snapshots
            COMPTE   : final = engagement·.55 + couverture·.25 + récence·.20  (3 composantes)
                       + concentration_risk / decision_maker_coverage (affichés à part)
                       + recommandations (priorités hétérogènes)
```

Il n'y a **ni registre de marqueurs, ni `marker_event`, ni `scoring_params`
versionnés, ni Météo 6 cadrans, ni mode Palier/Spec**. Le « score-batch » est
un calcul statistique dont deux entrées (Confiance, Satisfaction) sont des
sorties LLM brutes.

---

## C. Comparatif exact (Règle canonique V6 / Code actuel / Écart / Gravité)

| Règle V6 | Code actuel | Écart | Gravité |
|---|---|---|---|
| Pas de chiffre sans marqueur daté (`marker_id`, `observed_at`, `source`, `evidence_ref`, `evidence_text`) | Aucun marqueur ; scores = stats + LLM | **Total** : traçabilité au marqueur inexistante | 🔴 Critique |
| Absence ≠ 50 ; hors fenêtre → null | Confiance/Satisfaction **`?? 50`** et **entrent dans la moyenne** | Défaut 50 fabriqué → score biaisé | 🔴 Critique |
| Aucun chiffre LLM libre | `trust`/`satisfaction` = **nombres 0-100 décidés par le LLM**, injectés tels quels | Le LLM décide 50 % du poids (0.25+0.25) | 🔴 Critique |
| Absence = fiabilité (X01) | Pas de marqueur X01 ; canaux non captés non modélisés | Non implémenté | 🟠 Majeur |
| Revenu jamais dans le score | Respecté (revenu absent du calcul) | Conforme | 🟢 |
| Unité = dyade | Personne scorée globalement (`cognitive_profiles` par contact, pas par dyade owner↔contact stricte) ; snapshot = 1 par contact | Partiel : pas d'objet dyade explicite | 🟠 Majeur |
| Mode Palier (défaut) / Mode Spec | **Aucun des deux** (pas de points par palier) | Concept absent | 🔴 Critique |
| Score personne = C·.25+S·.25+E·.20+R·.20+A·.10 | **Formule finale identique** | Aucun (sur la forme) | 🟢 (forme) / 🔴 (entrées) |
| Axe = clamp(50 + Σ contributions) | Engagement/Récip/Ancrage : formules ad hoc **sans base 50 + contributions marqueurs** | Mécanique différente | 🔴 Critique |
| Répétition ×1 / ×1.4 / ×1.7 | Absente | Non implémenté | 🔴 Critique |
| Décroissance par magnitude (1/.7/.5/.35/.25/.2/.15/.1) | Absente | Non implémenté | 🔴 Critique |
| Volontarité (0.3/0.6/1.0 ; exécution 0.5/1.0) | Absente | Non implémenté | 🔴 Critique |
| S07 → Satisfaction ≤ 20 | Absent (pas de S07) | Non implémenté | 🔴 Critique |
| Météo compte = 6 cadrans pondérés | **3 composantes** (0.55/0.25/0.20) | Modèle entièrement différent | 🔴 Critique |
| Poids autorité (1.0/0.6/0.3/0.2) | Pondération compte = `1+interactions`, **pas** l'autorité de rôle | Différent | 🔴 Critique |
| Dyade active ≥5 échanges/12 mois | « engaged » = contact avec score ce mois-là | Seuil différent | 🟠 Majeur |
| Cadran Couverture (autorité couverts/cibles, plafond 40, −15 RCS) | `decision_maker_coverage` = ratio simple, **hors score** | Formule + emplacement différents | 🔴 Critique |
| Cadran Équilibre = 100·(1−HHI) | `concentration_risk` = part du top contact, **hors score** | Différent + hors score | 🔴 Critique |
| Cadran Dynamique (pente/silence/solde + K01/K02/K04) | Absent en tant que cadran ; `recencyComponent` ≈ silence partiel | Sous-composantes absentes | 🔴 Critique |
| K01–K09 (marqueurs compte) | **Aucun** | Non implémenté | 🔴 Critique |
| Résolution K : effet s'arrête à `resolved_at`, jamais supprimé | Pas de K ; (commitments M2 ont `resolved_at`, hors score) | N/A | — |
| Poids par type de relation (tableau §23) | Poids compte **fixes** (0.55/0.25/0.20) quel que soit le type | Table de poids par type inexistante | 🔴 Critique |
| Statut ≠ score (cadence propre) | `phase` (growth/stagnant/decline) via delta ; **pas** de statut Actif/Ralenti/Dormant/Rompu sur cadence | Statut cadence absent | 🟠 Majeur |
| Fiabilité = canal×volume×identité×diarisation ; min cadrans ≥15 % | `confidence = min(90, 20+interactions·2+axes·8)` (perso) / `min(90, 30+interactions)` (compte) | Formule inventée | 🔴 Critique |
| Rejeu : versions figées (`params_version`/`registry_version`) | Rejeu mensuel oui (deepBackfill, `snapshot_month`), **mais aucune version de params** | Versionnage absent | 🟠 Majeur |
| Profil comportemental hors score | Posture bien exclue ; **mais** trust/satisfaction (LLM) inclus | Conforme pour la posture, violé pour trust/satisfaction | 🔴 (via trust/sat) |
| Objectif compte n'influence pas la Météo | Objectif pas encore branché → OK aujourd'hui | Conforme (à préserver) | 🟢 |
| `account_fact` ≠ `marker_event` | Pas de `marker_event` du tout ; `account_facts` (M2) n'alimente aucun score | Séparation de fait respectée (par absence) | 🟢 (à formaliser) |
| Interdits UI (« 82 % churn », prédiction) | À vérifier UI ; scores affichés en /100 sans libellé probabiliste (voir P) | Globalement respecté | 🟢/🟠 |

---

## D. Audit des 22 marqueurs personne

**Aucun des 22 marqueurs (C01–C05, S01–S08, E01–E05, R01–R02, A01–A02) n'existe
dans le code** (grep sur les identifiants = 0 résultat). Il n'y a ni détecteur,
ni table, ni constante. Les axes sont produits ainsi :

- **Confiance** = `cognitive_profiles.trust_score` (LLM) `?? 50`. Le prompt
  (`behavior-analysis.ts`) demande au LLM un `score` 0-100 « fiabilité
  relationnelle » avec `status:insufficient`→null si pas de preuve. → viole
  « aucun chiffre LLM libre » ; le `?? 50` viole « jamais 50 ».
- **Satisfaction** = `satisfaction_score` (LLM) `?? 50`. Idem.
- **Engagement** = `scoreEngagement(stats)` : `baselineComponent·0.70 +
  richness·0.15 + depth·0.15` (baseline = récent/moyenne 90j ; richness selon
  nb de canaux ; depth = profondeur de fil). Aucun rapport avec E01–E05.
- **Réciprocité** = `scoreReciprocite(stats, type)` : `balance·0.50 +
  responseRate·0.30 + (responseTimeRatio/2)·0.20`, `balance = max(0.4, 1 −
  asym·w)` (w=0.35 pour types asymétriques, 0.60 sinon). Aucun rapport avec
  R01/R02 ; **R01 comparé à baseline** est partiellement respecté en esprit
  (responseTimeRatio contre 24h, pas la baseline dyade → écart avec V6).
- **Ancrage** = `scoreAncrage(carriers)` : 0/1/2/3+ → 0/25/60/100. **Barème
  identique à l'Ancrage COMPTE V6**, appliqué ici au niveau personne, sans
  marqueur A01/A02.

**Verdict D :** les 22 marqueurs sont à créer intégralement ; aucun n'est
réutilisable en l'état.

## E. Audit K01–K09

**Aucun marqueur compte n'existe.** Le code produit à la place des
*recommandations* (`category` texte : risque / risque_concentration / ownership
/ risque_churn / lecture_strategique) qui ne sont **pas** des marqueurs et
n'entrent **pas** dans le score. Les notions proches existent seulement comme
champs affichés hors score (`concentration_risk`, `decision_maker_coverage`).
K01–K09 (avec cadran cible, palier, résolution datée) sont **à créer**.

## F. Audit Mode Palier / Mode Spec

Les deux modes **n'existent pas**. Il n'y a ni table de paliers
(Faible/Moyen/Important/Critique/Neutre), ni points SPEC calibrés, ni
sélecteur de mode, ni `params_version` pour tracer lequel a produit un snapshot.
`model_version` est une simple chaîne (`relationship-score-v4`,
`account-relationship-score-v1`). **À créer.**

## G. Audit répétition & décroissance

- **Répétition ×1/×1.4/×1.7** : absente.
- **Décroissance par magnitude (8 rangs)** : absente.
- **Décroissance temporelle** : correctement **absente** (V6 l'interdit tant que
  non calibrée) — ✅ aucun decay temporel silencieux détecté. À préserver.

## H. Audit cold start P5 / verdict P7

- **P5 (age<30j OU <5 épisodes → ni score ni statut)** : **non implémenté**. Le
  seul garde-fou est `stats.totalInteractions === 0 → skip`. Une relation à 1–4
  épisodes est scorée (avec Confiance/Satisf = 50 par défaut).
- **P7 (<5 marqueurs → score sans verdict)** : **non implémenté** au sens
  marqueurs (il n'y a pas de marqueurs). L'UI a un texte « sans verdict sous 5
  marqueurs » (ScoreModal compte) mais **rien ne le calcule**.

## I. Audit rôles & autorité

- **Poids d'autorité (Décideur 1.0 / Influenceur 0.6 / Utilisateur 0.3 / Filtre
  0.2)** : **non appliqués** au score. Les rôles existent (`account_contact_roles`
  : `decision_role`, `relationship_role`, `organizational_role`, `exchange_share`)
  et sont **affichés**, mais l'agrégation compte pondère par `1+interactions`,
  pas par l'autorité de rôle. `decision_maker_coverage` utilise les rôles mais
  hors score. Rôle inféré + corrigeable : partiellement présent (chip Relation,
  rôles éditables), mais pas de pondération autorité dans le calcul.

## J. Audit des six cadrans Météo

| Cadran V6 | Présent ? | Réalité code |
|---|---|---|
| Satisfaction (25 %) | ❌ | Pas de cadran ; pas d'axe S compte pondéré autorité |
| Confiance & réciprocité (20 %) | ❌ | Absent |
| Couverture (20 %) | Partiel, **hors score** | `decision_maker_coverage` = ratio simple |
| Équilibre (15 %) | Partiel, **hors score** | `concentration_risk` (≈ 1−équilibre), non pondéré HHI complet |
| Ancrage (10 %) | Partiel | barème porteurs identique, mais au niveau personne, pas cadran compte |
| Dynamique (10 %) | ❌ | `recencyComponent` ≈ silence partiel seulement |

Le score compte réel = `0.55·engagement + 0.25·couverture + 0.20·récence`.
**La Météo 6 cadrans est à construire ; le modèle actuel ne s'y mappe pas.**

## K. Audit poids selon type de relation

- **Score compte** : poids **fixes** (0.55/0.25/0.20), aucun tableau par type.
  Seul effet du type : `scoreReciprocite` atténue l'asymétrie pour
  `ASYMMETRIC_RELATIONSHIP_TYPES` (Prospect/Client/Fournisseur/Investisseur) —
  au niveau **personne**, pas via la table de cadrans V6.
- La table §23 (Client/Fournisseur/Partenaire/Investisseur/Interne) **n'existe
  pas**. Rien n'est présenté comme « provisoire » car rien n'est présenté du
  tout. À créer en marquant explicitement tout sauf Client/Prospect comme
  provisoire.

## L. Audit statut relationnel

- `phase` ∈ {growth, stagnant, decline} calculée sur le **delta de score**
  (±8, decline si score ≤ 70). Ce n'est **pas** le statut V6
  (Actif/Ralenti/Dormant/Rompu sur **cadence propre**). Le statut cadence,
  X02→Rompu, sont **absents**. `phase` mélange en partie tendance et niveau.

## M. Audit fiabilité

- Personne : `confidence = min(90, 20 + totalInteractions·2 + measuredAxisCount·8)`.
- Compte : `confidence = min(90, 30 + totalInteractions)`.
- **Aucun facteur canal / identité / diarisation / fraîcheur / X01.** Les seuils
  UI V6 (≥0.60 verdict, 0.50–0.59 ambre, <0.50 grisé) **ne sont pas** pilotés par
  cette valeur (échelle 0-90 ≈ « points », pas 0-1). Formule à remplacer.

## N. Audit rejeu temporel

- Le rejeu existe (deepBackfill reconstruit l'historique réel, `snapshot_month`
  distinct de `computed_at`, escalier mensuel, pas de lissage) — **conforme en
  esprit** à « que vaudrait la relation à cette date vu ce qu'on sait
  aujourd'hui ».
- **Écart** : aucun `params_version` / `registry_version` figé → un rejeu après
  changement de code n'est pas comparable de façon garantie. `extraction_window`
  absent. Versionnage à ajouter.
- ⚠️ **Ambiguïté spec** : §26 liste « Pas mensuel » alors que le PDF T6 dit « le
  pas est le mois ». Le code est **mensuel** (cohérent avec le PDF). À trancher
  avant toute action.

## O. Audit du score de priorité actuel

Aucune échelle commune. Sources et échelles constatées :

| Source | Formule | Échelle |
|---|---|---|
| `score-batch` reco « Renouer » | `min(100, 50+|delta|)` | 0-100 |
| `score-batch` reco « Reprendre contact » | `min(90, 40+jours/5)` | 0-90 |
| `score-batch` reco ancrage | `45` fixe | — |
| `score-batch` opportunité poste | `70` fixe | — |
| `score-batch` risque compte | `min(100, 50+|phaseDelta|)` | 0-100 |
| `score-batch` concentration | `concentration_risk` (un %) | 0-100 (autre sémantique) |
| `score-batch` ownership | `60` fixe | — |
| `score-batch` signal→reco | `75` fixe | — |
| `account-strategic-reading` | `70 − index·5` | décroissant |
| `monitor-company-news` | `priorityFor(family)` | **texte** high/medium/info |
| `monitor-contacts` | `'high'` | **texte** |

→ **« prio 92 » et « prio 88 » ne sont pas comparables** : mélange d'échelles
numériques hétérogènes et de libellés texte, aucune décomposition
Impact/Urgence/Nouveauté/Fiabilité/Actionnabilité/Objectif. `company_signals.priority`
(texte) **n'est même pas lu par l'UI** (les signaux sont triés `observed_at DESC`).
Le `account-ranking.ts` conçu précédemment **n'est pas implémenté**.

## P. Liste des nombres hardcodés (scoring)

Personne : poids axes `.25/.25/.20/.20/.10` ; `scoreEngagement` `.70/.15/.15`,
richness `100/65/25`, `depth/5`, ratio cap `4`, jeune `<45j` ; `scoreReciprocite`
`.50/.30/.20`, `asymWeight 0.35/0.60`, `balance min 0.40` ; `scoreAncrage`
`0/25/60/100` ; `PHASE_DELTA 8`, `PHASE_DECLINE_MAX 70` ; confidence
`min(90, 20 + interactions·2 + axes·8)` ; `?? 50` (Confiance/Satisf) ;
`responseRate` fallback `0.3`, `avgRt` fallback `24`, `ANCRAGE_MIN_MESSAGES_PER_CARRIER 3`.
Compte : `0.55/0.25/0.20` ; `ACCOUNT_RECENCY_HALFLIFE_DAYS 90` ;
`ACCOUNT_PHASE_DELTA 8` ; `ACCOUNT_PHASE_DECLINE_MAX 70` ; neutre `50` si aucun
engagé ; confidence `min(90, 30+interactions)` ; concentration seuil `70` (reco) ;
`ACCOUNT_RELATION_MIN_CONFIDENCE 55`, `ACCOUNT_RELATION_MIN_SHARE 0.55`.
Priorités : voir §O. Aucun de ces nombres n'est dans un `scoring_params` versionné.

## Q. Calculs LLM non déterministes (dans/autour du score)

1. **`trust.score` (Confiance)** — nombre 0-100 **décidé par le LLM** → entre à 25 % dans le score. 🔴
2. **`satisfaction.score` (Satisfaction)** — idem, 25 %. 🔴
3. `account_relation_hint` (catégorie) — LLM, mais agrégé déterministe (pondéré confiance) et **hors score** → acceptable.
4. Posture (rythme/argumentation/…) — LLM, **hors score** (coaching) → conforme §27.
5. `account-strategic-reading` — LLM, produit texte **et** recommandations `lecture_strategique` (priorité `70−index·5`) → priorité non déterministe, hors Météo.
6. Extraction moments/engagements (M2) — LLM, **hors score** aujourd'hui → conforme.

**Le seul point bloquant V6 : (1) et (2)** — la moitié du poids du score personne
est un nombre LLM libre.

## R. Résultat des deux tests de référence

### R.1 — Test personne (attendu : C 82 · S 17 · E 72 · R 38 · A 78 → **55**)

**NON reproductible.** Le test fournit des **marqueurs** (C01×1, C04×3, S01, S02,
S03, S08, E01, E05×2, R01, R02, A01, A02) et attend le calcul base-50 + points ×
volontarité × répétition × décroissance. **Le code n'a aucun moteur de
marqueurs** : il ne peut pas ingérer ces entrées. Ses axes viennent de
`trust`/`satisfaction` (LLM) et de statistiques d'emails. Donc :
- Confiance attendue 82 (C01+C04×3) : le code lirait `trust_score` LLM, sans
  rapport avec C01/C04.
- Satisfaction attendue 17 (S02/S01/S03 dominants, S08 faible via décroissance) :
  le code lirait `satisfaction_score` LLM.
- Engagement/Réciprocité/Ancrage : formules statistiques, pas E/R/A markers.
**Raison précise de l'échec : le mécanisme de calcul V6 (marqueurs → paliers →
volontarité → répétition → décroissance → base 50) est entièrement absent.**

### R.2 — Test compte (attendu cadrans : Sat 46 · C&R 60 · Couv 23 · Équ 4 · Anc 25 · Dyn 17 → Météo **33**, fiab 0.70, faible = Équilibre)

**NON reproductible.** Le code ne calcule pas ces 6 cadrans. Sa formule compte
est `0.55·engagement + 0.25·couverture + 0.20·récence`. Avec les entrées du test
(1 dyade active S46/C62/R58, décideur non actif, 1 porteur, Δ−6, silence 21j/9j,
solde −1, K04) le code **n'a ni cadran Satisfaction, ni Confiance&Réciprocité, ni
Équilibre HHI, ni Dynamique pente/silence/solde, ni marqueur K04**. Il produirait
un nombre via un tout autre chemin, non comparable à 33. **Raison : Météo 6
cadrans + K non implémentés.**

> Les deux exemples chiffrés V6 sont donc des **spécifications cibles**, pas des
> tests que le code actuel peut passer. Ils deviendront des tests de
> non-régression une fois le moteur de marqueurs construit.

## S. Architecture cible minimale (proposition, non exécutée)

Aligner sur le pipeline V6 §30, **sans dupliquer un second scoring concurrent** :

```
SOURCE → EXTRACTION (LLM: extrait/qualifie, ne note jamais)
       → account_facts / person_facts (mémoire, M2)
       → DÉTECTEUR DE MARQUEUR (déterministe: un fait ne devient marker_event
         que s'il satisfait la règle écrite du marqueur, daté, sourcé)
       → marker_event (C01…/K01…/X01…, dyad_id|account_id, observed_at,
         resolved_at, sense, measure, source, evidence_ref/text, detector_version)
       → MOTEUR DE SCORING VERSIONNÉ (params_version + registry_version, mode
         Palier|Spec, base 50 + points·vol·rép·décroissance, 5 axes / 6 cadrans,
         autorité, fiabilité V6, P5/P7)  → score_snapshot (reproductible)

  et en PARALLÈLE, indépendant :
account_facts → MOTEUR DE PERTINENCE (impact·urgence·nouveauté·fiabilité·
                actionnabilité·lien-objectif, normalisé 0-1 → 0-100)
              → signaux / recommandations (jamais une Météo)
```

Objets à créer : `marker_registry` (versionné), `marker_event`, `scoring_params`
(versionné, immuable), `score_snapshot` (avec `params_version`/`registry_version`/
`extraction_window`/`contributing_events` par axe/cadran). Trust/Satisfaction
LLM → **remplacés** par des marqueurs S/C détectés (le LLM extrait le marqueur,
la formule fait la note). Le score de pertinence reste un **moteur distinct**.

## T. Plan de migration (proposition, NON exécutée — attente de décision)

Additif, réversible, jamais de double-scoring en parallèle non tracé :

1. **Geler la sémantique** : figer le scorer actuel comme `params_version='legacy-v4'`
   (aucun changement de valeur), pour pouvoir comparer.
2. **Registre + détecteurs** : créer `marker_registry` (Palier + Spec) et les
   détecteurs déterministes des marqueurs les plus sûrs d'abord (K02 créance,
   K04 livrable dû, S04 relance sans réponse, R01 latence vs baseline…),
   branchés sur `account_facts`/emails — **sans** encore alimenter un score.
3. **`marker_event` en shadow** : produire les événements, les inspecter (comme
   M2), zéro impact score.
4. **Moteur V6 en shadow** : calculer Météo 6 cadrans + score personne marqueurs
   **en parallèle** du legacy, versionné, **non affiché**. Comparer sur comptes
   réels (dont les 2 tests de référence).
5. **Fiabilité + P5/P7 + statut cadence** : implémenter, valider seuils.
6. **Bascule lecture** derrière feature flag, legacy conservé en secours.
7. **Score de pertinence** : audit terminé → proposer pondérations + sensibilité
   + cas réels (à valider séparément), puis brancher le ranking.
8. **Nettoyage** legacy seulement après validation.

Rien de ceci n'est fait. **Aucune valeur de score en production n'a été
touchée.** Décisions attendues : (a) trancher l'ambiguïté « pas mensuel » (§N) ;
(b) confirmer que trust/satisfaction LLM doivent devenir des marqueurs détectés ;
(c) ordre de construction des détecteurs de marqueurs ; (d) statut du score de
pertinence (moteur séparé, oui/non).

---

## Doctrine retenue (rappel, appliquée à partir de maintenant)

Pas de règle écrite → pas de points. Pas de marqueur daté → pas de points. Pas
de preuve → pas de points. Absence → fiabilité, pas score. Un fait n'est pas un
marqueur. `marker_event` = seule porte d'entrée du scoring relationnel. Une reco
n'est jamais un fait. Une priorité n'est jamais une Météo. Le LLM extrait et
explique, il ne fabrique pas une note. Un paramètre provisoire reste affiché
comme provisoire. Tout score reproductible à version identique.
