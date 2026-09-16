# Scoring V6 — Design S0 (infrastructure, avant toute migration)

> **Design seul. Rien n'est appliqué** : pas de migration, pas de détecteur, pas
> d'UI, pas de changement legacy, pas de généralisation M2. Le moteur V6 est
> construit **en shadow**. Aucune bascule tant que les tests `reference_person_v6`
> (55) et `reference_account_v6` (33) ne passent pas.
> Réfs : spec V6.0 + [AUDIT_SCORING_V6.md](AUDIT_SCORING_V6.md) + [SCORING_DOCTRINE.md](SCORING_DOCTRINE.md).

Décisions actées : le pas est **le mois** (escalier, jamais lissé) ; trust/satisfaction
LLM deviennent **legacy** et ne sont **jamais** consommés par V6 ; registre **fermé** ;
pas de preuve → pas de `marker_event` ; `account_fact` ≠ `marker_event` ;
pertinence = **moteur séparé** construit après S0–S3.

---

## A. Schéma exact (4 tables, shadow — non appliquées)

### A.1 `marker_registry` (versionné, immuable par version)
```sql
create table scoring.marker_registry (
  registry_version text not null,                 -- ex. 'reg-v6.0'
  marker_id     text not null,                    -- 'C01'…'A02', 'K01'…'K09', 'X01'…'X03' ; jamais recyclé
  scope         text not null check (scope in ('person','account','out_of_score')),
  axis_or_dial  text,                             -- 'confiance'|'satisfaction'|'engagement'|'reciprocite'|'ancrage'
                                                  --  | 'dyn_satisfaction'|'dyn_confiance_recip'|'couverture'|'equilibre'|'ancrage_compte'|'dynamique'
                                                  --  | null pour X01–X03
  tier          text not null check (tier in ('faible','moyen','important','critique','neutre')),
  pts_spec      integer,                          -- points calibrés V5.1 (mode SPEC) ; null si non calibré
  sign          integer check (sign in (-1, 0, 1)), -- 0 = bipolaire (sens = mesure) ; sinon signe fixe
  vol_base      numeric not null,                 -- 0.3 | 0.6 | 1.0
  manipulable   text not null check (manipulable in ('non','oui','difficile')),
  cost          text not null,                    -- = tier (non-manipulabilité et coût : même propriété)
  rule          text,                             -- règle textuelle (plafonds, escalades, résolution)
  deprecated_at date,                             -- déprécié, jamais supprimé
  primary key (registry_version, marker_id)
);
```

### A.2 `scoring_params` (versionné, immuable une fois publié)
```sql
create table scoring.scoring_params (
  params_version text primary key,                -- ex. 'params-v6.0'
  mode          text not null check (mode in ('palier','spec')),
  status        text not null check (status in ('validated','provisional','blocked')),
  tiers         jsonb not null,                   -- { faible:{pos:6,neg:-8}, moyen:{pos:12,neg:-14}, important:{pos:20,neg:-20}, critique:{pos:0,neg:-30}, neutre:{pos:0,neg:0} }
  repetition    jsonb not null,                   -- [ {min:1,max:1,mult:1.0}, {min:2,max:3,mult:1.4}, {min:4,mult:1.7} ]
  decay         numeric[] not null,               -- [1.0,0.7,0.5,0.35,0.25,0.2,0.15,0.1]  (rang 8+ → dernier)
  axis_weights  jsonb not null,                   -- { confiance:.25, satisfaction:.25, engagement:.20, reciprocite:.20, ancrage:.10 }
  dial_weights  jsonb not null,                   -- { 'Client/Prospect':{...6}, Fournisseur:{...}, Partenaire:{...}, Investisseur:{...}, Interne:{...} } + status par colonne
  authority     jsonb not null,                   -- { decideur:1.0, influenceur:0.6, utilisateur:0.3, filtre:0.2 }
  anchoring     jsonb not null,                   -- { '0':0, '1':25, '2':60, '3+':100 }
  coverage      jsonb not null,                   -- { cap_decideur_sans_dyade:40, malus_rcs_non_reflete:-15 }
  dynamics      jsonb not null,                   -- { poids:{pente:.30,silence:.40,solde:.30}, pente:{p5:100,p0:50,m10:0}, silence:{r1:100,r2:50,r3:0}, solde:{base:50,step:10} }
  thresholds    jsonb not null,                   -- { dyade_active_min_echanges:5, dyade_active_fenetre_mois:12, p5_age_min_j:30, p5_episodes_min:5, p7_marqueurs_min:5, p4_episodes_min:8, reliability:{verdict:0.60,amber:0.50} }
  published_at  timestamptz not null default now()
);
-- Invariant applicatif : jamais d'UPDATE sur une ligne publiée. Changement = nouvelle params_version.
```

### A.3 `marker_event` (occurrence observée)
```sql
create table scoring.marker_event (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  registry_version text not null,
  marker_id     text not null,                    -- doit exister dans marker_registry(registry_version, marker_id)
  scope         text not null check (scope in ('person','account')),
  dyad_id       uuid,                             -- obligatoire si scope='person' (contact ↔ collaborateur)
  contact_id    uuid,                             -- côté externe de la dyade
  collaborator_user_id uuid,                       -- côté interne de la dyade
  account_id    uuid,                             -- obligatoire si scope='account'
  observed_at   timestamptz not null,             -- date du FAIT (jamais de la détection)
  resolved_at   timestamptz,                      -- K : effet s'arrête ici, marqueur conservé
  sense         integer not null check (sense in (-1,1)), -- pour bipolaires : sens mesuré
  measure       jsonb,                            -- ce qui a été mesuré (latence, largeur cc, montant…) pour audit
  source        text not null,                    -- gmail|outlook|gcal|readai|notion|pappers|tohu_gesture|tohu_analysis
  evidence_ref  text not null,                    -- OBLIGATOIRE (id message/transcript/document) — sinon pas d'event
  evidence_text text not null,                    -- OBLIGATOIRE (verbatim ou fait, une phrase)
  detector_version text not null,
  deprecated_at timestamptz,
  created_at    timestamptz not null default now(),
  check ((scope='person' and dyad_id is not null) or (scope='account' and account_id is not null))
);
create index marker_event_dyad_idx on scoring.marker_event(dyad_id, observed_at);
create index marker_event_account_idx on scoring.marker_event(account_id, observed_at);
-- Contrat anti-hallucination : NOT NULL sur evidence_ref/evidence_text/observed_at
-- → un marqueur sans preuve/date ne peut PAS être inséré.
```

### A.4 `score_snapshot` (résultat reproductible)
```sql
create table scoring.score_snapshot (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('dyad','account')),
  entity_id     uuid not null,                    -- dyad_id ou account_id
  at            timestamptz not null,             -- date de rejeu (T)
  snapshot_month date,                            -- 1er du mois représenté (escalier mensuel)
  params_version text not null,
  registry_version text not null,
  extraction_window jsonb,                        -- fenêtre d'extraction déclarée
  axes_or_dials jsonb not null,                   -- { <axe|cadran>: { value:number|null, weight:number, reliability:number, contributing_events:[marker_event.id...] } }
  score         numeric,                          -- null si non calculable (P5)
  reliability   numeric,
  verdict_allowed boolean not null,               -- P7 : ≥5 marqueurs datés
  status        text,                             -- dyade : Actif|Ralenti|Dormant|Rompu ; compte : n/a ou dérivé
  weakest_dial  text,
  delta_30d     numeric,
  percentile    jsonb,                            -- { rank, of }
  created_at    timestamptz not null default now(),
  unique (entity_type, entity_id, snapshot_month, params_version, registry_version)
);
```

> Schéma `scoring` séparé (pas `public`) pour isoler le shadow du legacy et faciliter un rollback (`drop schema scoring cascade`).

---

## B. Mapping des 22 marqueurs personne

`sign`: `+` positif fixe, `−` négatif fixe, `±` bipolaire (sens = mesure).
`pts_spec` = mode SPEC (V5.1). En mode **Palier** (défaut), `pts = sign × tiers[tier][pos|neg]`.

| id | axe | palier | pts_spec | vol_base | sign | manip | détection |
|----|-----|--------|---------:|:--------:|:----:|:-----:|-----------|
| C01 | confiance | important | +20 | 1.0 | + | non | divulgation interne/personnelle non nécessaire à la tâche |
| C02 | confiance | faible | +6 | 0.6 | + | oui | réduction largeur du cc vs baseline |
| C03 | confiance | moyen | +10 | 1.0 | + | oui | baisse du hedging vs baseline |
| C04 | confiance | moyen | +14 | 1.0 | + | oui | registre informel (tutoiement, surnom, emoji, humour) |
| C05 | confiance | important | +18 | 1.0 | + | non | jugement personnel partagé sur un tiers absent |
| S01 | satisfaction | moyen | −14 | 1.0 | − | non | ré-inflation de formalité vs baseline |
| S02 | satisfaction | important | −16 | 1.0 | − | non | escalade de cc vers séniorité supérieure |
| S03 | satisfaction | moyen | −12 | 1.0 | − | non | appréciation négative explicite |
| S04 | satisfaction | faible | −8 | 1.0 | − | non | même demande relancée ≥2× sans réponse |
| S05 | satisfaction | faible | −8 | 1.0 | − | oui | rituel qu'il portait annulé, non replanifié 14 j |
| S06 | satisfaction | important | −14 | 1.0 | − | non | désintermédiation / contournement |
| S07 | satisfaction | critique | −30 | 1.0 | − | non | dénonciation auprès d'un tiers · **règle : Satisfaction ≤ 20** · propage aux comptes liés |
| S08 | satisfaction | moyen | +12 | 1.0 | + | difficile | éloge spontané hors politesse |
| E01 | engagement | important | +20 | 1.0 | + | non | mise en relation avec un tiers de son réseau |
| E02 | engagement | important | +18 | 1.0 | + | non | ouverture de son organigramme |
| E03 | engagement | moyen | +10 | 0.6 | + | oui | projection au-delà de l'engagement courant |
| E04 | engagement | important | +18 | 1.0 | + | difficile | livrable / débrief non demandé |
| E05 | engagement | faible | ±6 | 0.3 | ± | oui | acceptation des réunions sollicitées |
| R01 | reciprocite | important | ±16 | 1.0 | ± | non | latence lui→toi vs toi→lui **contre baseline dyade** · déficit de ton côté = neutre |
| R02 | reciprocite | moyen | ±14 | 1.0 | ± | difficile | initiation substantielle vs simple relance · la relance ne compte pas positivement |
| A01 | ancrage | important | ±16 | 1.0 | ± | non | diversité de canaux instrumentés actifs |
| A02 | ancrage | moyen | ±14 | 1.0 | ± | non | continuité entre périodes |

**Hors score (X, jamais de points) :** `X01` canal non instrumenté → baisse
fiabilité ; `X02` rupture typée → force statut Rompu ; `X03` rupture de rituel
subie (de notre côté) → engagements/contexte.

---

## C. Mapping K01–K09 (marqueurs compte)

| id | cadran | palier | pts_spec | règle | résolution | plafond |
|----|--------|--------|---------:|-------|------------|---------|
| K01 | dynamique | important | −20 | une fois ; si ouvert > 12 mois | flux observé | **Dynamique ≤ 15** si > 12 mois |
| K02 | dynamique | important→critique | −25 / −40 | −25 si > 30 j, escalade critique si > 90 j | créance réglée (`resolved_at`) | — |
| K03 | satisfaction | important | −20 | par demande, × répétition | réponse reçue | — |
| K04 | dynamique | moyen | −15 | compte **aussi** comme engagement glissé (solde Dynamique) | livraison | — |
| K05 | ancrage | important | −20 | par porteur parti sans passation | réattribution (levé) | — |
| K06 | satisfaction | critique | −40 | rétention de livrable comme moyen de pression | livraison | **Satisfaction ≤ 20** tant qu'ouvert |
| K07 | satisfaction | faible→important | −10 / −25 | −10 par incident ; −25 si non résolu sous 7 j | incident clos | — |
| K08 | ancrage | moyen | −15 | par occurrence, × répétition | boîte réactivée / contact corrigé | — |
| K09 | couverture | **neutre** | 0 | **alerte, 0 point** | dyade directe établie | état « couvert par escalade » |

> K02/K07 escaladent de palier selon l'âge/la résolution : le **détecteur**
> détermine le tier applicable à `observed_at`, le moteur applique le tier fourni.
> Ne jamais coder simultanément valeurs SPEC et Palier — le `mode` de
> `scoring_params` tranche.

---

## D. Paramètres V6 (contenu de `params-v6.0`, mode Palier)

```jsonc
tiers      = { faible:{pos:+6, neg:-8}, moyen:{pos:+12, neg:-14}, important:{pos:+20, neg:-20}, critique:{pos:0, neg:-30}, neutre:{pos:0, neg:0} }
repetition = [ {occ:1, mult:1.0}, {occ:"2-3", mult:1.4}, {occ:"4+", mult:1.7} ]
decay      = [1.00, 0.70, 0.50, 0.35, 0.25, 0.20, 0.15, 0.10]   // rang 8+ → 0.10 ; PAS de decay temporel
volontarite= { prescrit:0.3, semi:0.6, volontaire:1.0,  execution:{ prescrit:0.5, semi:1.0, volontaire:1.0 } }
axis_weights (personne, fixes tous types) = { confiance:.25, satisfaction:.25, engagement:.20, reciprocite:.20, ancrage:.10 }
dial_weights['Client/Prospect'] = { satisfaction:.25, confiance_recip:.20, couverture:.20, equilibre:.15, ancrage:.10, dynamique:.10 }
authority  = { decideur:1.0, influenceur:0.6, utilisateur:0.3, filtre:0.2 }
anchoring  = { 0:0, 1:25, 2:60, "3+":100 }
coverage   = { cap_decideur_sans_dyade:40, malus_rcs_non_reflete:-15 }
dynamics   = { poids:{pente:.30, silence:.40, solde:.30},
               pente:  {ancres:[{d:+5,v:100},{d:0,v:50},{d:-10,v:0}], interp:"linéaire"},
               silence:{ancres:[{r:1,v:100},{r:2,v:50},{r:3,v:0}],   interp:"linéaire", ratio:"jours_depuis_dernier / cadence_médiane"},
               solde:  {formule:"50 + 10×(tenus − glissés sur 90j)", clamp:[0,100]} }
thresholds = { dyade_active:{min_echanges:5, fenetre_mois:12, requiert_score_personne:true},
               p5:{age_min_j:30, episodes_min:5}, p7:{marqueurs_min:5}, p4:{episodes_min:8},
               reliability:{verdict:0.60, amber:0.50} }
```
Poids autres types (provisional) — à conserver mais marqués provisoires (§E) :
```
Fournisseur : Sat .30 · C&R .25 · Couv .05 · Équ .05 · Anc .15 · Dyn .20
Partenaire  : Sat .15 · C&R .25 · Couv .15 · Équ .15 · Anc .10 · Dyn .20
Investisseur: Sat .15 · C&R .30 · Couv .20 · Équ .05 · Anc .20 · Dyn .10   (Couv→30 en fenêtre d'événement, autres au prorata)
Interne     : Sat .20 · C&R .30 · Couv .05 · Équ .05 · Anc .30 · Dyn .10
```

---

## E. Statut explicite des paramètres

| Paramètre | Statut | Justification |
|---|---|---|
| Mécanique Palier (tiers, répétition, décroissance, volontarité) | **validated** | reproduit les fiches livrées + tests de référence |
| `axis_weights` personne | **validated** | calibration manuelle, Spearman r≈0.72 (n=25) — validé *au sens reproductible*, base d'échantillon petite (à afficher) |
| `dial_weights['Client/Prospect']` | **validated** | seule colonne validée |
| `authority`, `anchoring`, HHI Équilibre | **validated** | issus de la littérature / mécaniques figées |
| `dial_weights` Fournisseur / Partenaire / Investisseur / Interne | **provisional** | proposés, non calibrés — **ne jamais présenter comme scientifiques** |
| `dynamics` ancres pente/silence/solde | **provisional** | fixées à la main |
| Formule de fiabilité (facteurs + pondération) | **provisional** | à valider |
| Seuil K07 « < 7 j » | **provisional** | à confirmer |
| **Rétro-test des poids compte** (pertes portefeuille) | **blocked** | non réalisé → Météo = *lecture structurée, pas prédiction* |
| Décroissance temporelle (?D01) | **blocked** | pas de vérité terrain |
| Saturation d'axe (?E06) | **blocked** | corrélation faible |

---

## F. Design des deux fonctions pures (non branchées DB)

### F.1 `calculateDyadScore(markerEvents, role, params, registry, at)`
Pure : mêmes entrées → mêmes sorties. Aucun accès DB, aucun LLM.

```
1. events = markerEvents filtrés : scope='person', observed_at ≤ at, deprecated_at null
2. pour chaque axe A ∈ [confiance, satisfaction, engagement, reciprocite, ancrage] :
     axisEvents = events dont registry[marker_id].axis == A
     si axisEvents vide :
        value[A] = 50 (base observée)      // le null (hors fenêtre) est décidé par la couche P5/P7, pas ici
        contributing[A] = []
        continue
     // regrouper par (marker_id, sense) → occurrences
     terms = []
     pour chaque groupe (mid, sense) :
        m   = registry[mid]
        pts = params.mode=='spec' ? m.pts_spec
                                  : sense_effectif × params.tiers[m.tier][sense_effectif>0 ? 'pos':'neg']
              // sense_effectif = m.sign≠0 ? m.sign : sense
        vol = renormaliser(m.vol_base, role, params.volontarite)   // rôle Exécution : 0.3→0.5, 0.6→1.0
        rep = params.repetition(nbOccurrences)                     // 1 / 1.4 / 1.7
        magnitude = |pts| × vol × rep
        terms.push({ magnitude, signedContribution: sign(pts) × magnitude, mid, occ })
     terms.sort(magnitude desc)                                    // décroissance PAR MAGNITUDE
     total = Σ_i terms[i].signedContribution × params.decay[min(i, decay.length−1)]
     value[A] = clamp(round(50 + total), 0, 100)
     si A=='satisfaction' et un S07 présent : value[A] = min(value[A], 20)   // plafond critique
     contributing[A] = ids des marker_events de A
3. score = round( Σ_A value[A] × params.axis_weights[A] )
4. retourne { score, axes:{A:{value, weight, contributing}}, params_version, registry_version, at }
```
Fiabilité, statut cadence, P5 (null), P7 (verdict) : **couche séparée** (ont besoin
de canaux/identité), jamais dans ce calcul pur.

**Vérification `reference_person_v6` (mode Palier) :**
```
Confiance    : C01 20·decay1(1.0)=20 ; C04 12·vol1·rep1.4=16.8·decay2(0.7)=11.76 → 50+31.76 = 81.76 → 82
Satisfaction : S02 -20·1.0 ; S01 -14·0.7=-9.8 ; S03 -14·0.5=-7.0 ; S08 +12·0.35=+4.2 → 50-32.6 = 17.4 → 17
Engagement   : E01 20·1.0 ; E05 6·vol0.3·rep1.4=2.52·0.7=1.76 → 50+21.76 = 71.76 → 72
Réciprocité  : R01 -20·1.0 ; R02 +12·0.7=+8.4 → 50-11.6 = 38.4 → 38
Ancrage      : A01 20·1.0 ; A02 +12·0.7=+8.4 → 50+28.4 = 78.4 → 78
Score = 82·.25 + 17·.25 + 72·.20 + 38·.20 + 78·.10 = 20.5+4.25+14.4+7.6+7.8 = 54.55 → 55 ✓
```
(S01/S03 à magnitude égale 14 : l'ordre des rangs 2/3 est indifférent, {0.7,0.5} sur deux −14.)

### F.2 `calculateAccountWeather(activeDyads, targetRoles, carriers, accountMarkers, dynamicsInputs, relationType, params, registry, at)`

```
A = rôle → params.authority[rôle]
dials = {}
dials.satisfaction     = base_wavg(activeDyads, d→d.S, A) + Σ K∈{K03,K06,K07} ; cap 20 si K06 ouvert
dials.confiance_recip  = base_wavg(activeDyads, d→(d.C+d.R)/2, A)            // aucun K
dials.couverture       = 100 × Σ A(couverts)/Σ A(cibles) ; −15 si RCS non reflété ; plafond 40 si décideur sans dyade directe
dials.equilibre        = 100 × (1 − Σ part_p²)  sur TOUS les interlocuteurs ; 0 si un seul
dials.ancrage          = params.anchoring[min(carriers,3)] + Σ K∈{K05,K08}
dials.dynamique        = clamp( .30×pente + .40×silence + .30×solde ) + Σ K∈{K01,K02,K04} ; plafond 15 si K01 ouvert > 12 mois
   pente   = interp linéaire de dynamicsInputs.delta30_5cadrans sur ancres pente
   silence = interp linéaire de (joursDepuisDernier / cadenceMédiane) sur ancres silence
   solde   = clamp(50 + 10×(tenus − glissés_90j), 0, 100)
// null : un cadran sans donnée = null (jamais 0/50). Poids redistribué au prorata :
w = params.dial_weights[relationType]
calculables = dials où value ≠ null
wsum = Σ w[d] sur calculables
score = round( Σ_{d∈calculables} value[d] × w[d]/wsum )
weakest = argmin(value[d]) ; reliability = min(rel[d]) sur d calculables et w[d] ≥ 0.15
retourne { score, dials:{d:{value,weight,contributing}}, weakest_dial, reliability, params_version, registry_version, at }
```

**Vérification `reference_account_v6` (Client/Prospect) :**
```
Satisfaction    = wavg({(0.3, 46)}) = 46                                → 46 ×.25 = 11.5
Confiance&Récip = wavg({(0.3, (62+58)/2=60)}) = 60                      → 60 ×.20 = 12.0
Couverture      = 100 × 0.3/(0.3+1.0) = 23.08 → 23 (plafond 40 non atteint) → 23 ×.20 = 4.6
Équilibre       = 100 × (1 − (0.978²+0.022²)) = 100×(1−0.957) = 4.3 → 4  → 4  ×.15 = 0.6
Ancrage         = anchoring[1] = 25                                    → 25 ×.10 = 2.5
Dynamique       : pente(Δ−6)=20 ; silence(21/9=2.33)=33 ; solde(1−2)=40
                  base = .30×20 + .40×33 + .30×40 = 6+13.2+12 = 31.2 → 31 ; +K04(−14) = 17 → 17 ×.10 = 1.7
Météo = 11.5+12.0+4.6+0.6+2.5+1.7 = 32.9 → 33 ✓   (faible = Équilibre)
```

---

## G. Tests unitaires prévus (S1/S2)

**Fonctionnels de référence (bloquants avant tout détecteur) :**
- `reference_person_v6` → axes 82/17/72/38/78, **score 55** (+ asserts par axe et par contribution).
- `reference_account_v6` → cadrans 46/60/23/4/25/17, **Météo 33**, weakest=Équilibre.

**Unitaires de mécanique :**
- tiers Palier (pos/neg par palier) ; mode SPEC ≠ mode Palier sur le même marqueur.
- répétition : 1→×1.0, 3→×1.4, 5→×1.7.
- décroissance : ordre par magnitude, coefficients rang 1→8+, rang 9 = 0.10.
- volontarité : E05 (0.3), E03 (0.6), rôle Exécution (0.3→0.5, 0.6→1.0).
- base 50 quand un axe n'a aucun marqueur ; **jamais 50** injecté pour une absence de fenêtre (retourne le flag pour la couche null).
- plafond S07 → Satisfaction ≤ 20 ; plafond K06 → Satisfaction compte ≤ 20 ; plafond K01>12mo → Dynamique ≤ 15.
- bipolaires : sense=+1 vs −1 sur R01/E05/A01.
- Météo : redistribution au prorata quand un cadran est null ; Équilibre = 0 pour un seul interlocuteur ; Couverture plafond 40 (décideur sans dyade).
- autorité : pondération wavg Décideur/Influenceur/Utilisateur/Filtre.
- rejeu : `score(at)` n'utilise que les marker_events `observed_at ≤ at` ; `delta_30d = score(at) − score(at−30j)` ; escalier mensuel, aucune interpolation.
- versionnage : même (events, params_version, registry_version, at) → snapshot identique.
- anti-hallucination : refus d'un marker_id absent du registre ; refus d'un event sans evidence_ref/observed_at.

---

## Ce qui suit (après validation de ce design S0)

S1 : implémenter `calculateDyadScore` (pur) + faire passer `reference_person_v6=55`.
S2 : `calculateAccountWeather` (pur) + `reference_account_v6=33`.
S3+ : détecteurs à forte certitude (ordre validé : K02 si données créance dispo,
K04 si obligation/échéance prouvables, S04, K08, E05 ; **R01 après** infra baseline
P4 ; puis statistiques ; puis sémantiques LLM en classificateur ; S07/K06 sous
politique de double validation **à te proposer**). P1–P7 traités avant
massification. Pertinence = moteur séparé, après S0–S3.

**Aucune de ces étapes n'est engagée.** Fin du design S0.
