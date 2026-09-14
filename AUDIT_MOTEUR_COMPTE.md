# Audit — Moteur intelligent de la fiche Compte

> Phase 1 (audit) + Phase 2 (architecture cible). **Aucun code modifié.**
> Basé sur lecture du code + inspection de la base de production (MCP `tohu-bohu`).
> Date : 2026-09-14.

---

## 0. Cartographie des 5 blocs (où vit quoi)

La fiche compte (`AccountDetailPage.tsx`) a **2 onglets** :

| Bloc demandé | Composant réel | Fichier | Onglet |
|---|---|---|---|
| **Ce que montrent les échanges** | `AccountInsight` (carte gauche) | `V48AccountViews.tsx:171` | Live |
| **Depuis votre dernier échange** | `AccountInsight` (spotlight droite) | `V48AccountViews.tsx:195` | Live |
| **Signaux récents** | `SignalFeed` | `V48AccountViews.tsx:309` | Live |
| **Stratégie de compte** | `StrategySection` | `AccountRelationView.tsx:453` | Relation |
| **Historique & mémoire du compte** | `HistorySection` | `AccountRelationView.tsx:556` | Relation |

Bloc bonus fortement lié : **Lecture stratégique** (`StrategicReadingSection`, `AccountRelationView.tsx:489`) — synthèse LLM, onglet Relation.

Chargement : **tout** est lu en une passe au page-load par `service.ts::getAccountDetail()` (≈16 requêtes en parallèle + 1 RPC). Rien n'est calculé au front à l'exception du regroupement/tri d'affichage.

---

## 1. Architecture actuelle — comment ça marche réellement

### A. Sources de données (ce qui alimente chaque bloc)

| Bloc | Source réelle | Nature |
|---|---|---|
| Ce que montrent les échanges | `companies.public_context.description` **sinon** template `« porté par {lead}, {x}% des échanges »` | **Statique / gabarit** — jamais dérivé du contenu des échanges |
| Depuis votre dernier échange | `data.signals[0]` (1er signal non-comportemental) | Signal brut, **pas un delta** |
| Signaux récents | `company_signals` (≤30, triés `observed_at DESC`) | Veille externe/interne |
| Stratégie de compte | `account_recommendations` (statut open/postponed, triés `priority DESC`) | Recos déterministes + LLM |
| Historique & mémoire | `company_signals` + `account_memory_entries` fusionnés (`momentsFrom`) | Signaux + notes manuelles |
| Lecture stratégique | `account_strategic_readings.content` (LLM, cache 7j) | Synthèse IA |

### B. Producteurs back (qui écrit, et quand)

- **`score-batch`** (cron) → `account_relationship_score_snapshots` (score + composantes) **et** `account_recommendations`. Règles 100 % déterministes :
  - `risque` si phase `declining` — `priority = min(100, 50+|delta|)`
  - `risque_concentration` si concentration > 70 % — `priority = concentration%`
  - `ownership` si compte stratégique sans owner — `priority = 60`
  - 1 reco `risque`/`risque_churn` **par signal de veille** — `priority = 75`
- **`account-strategic-reading`** (à la demande, cache serveur 7j) → `account_strategic_readings` **et** recos `lecture_strategique` (`priority = 70 − index·5`). Consomme `person_key_moments`, `person_memory_entries[commitment]`, `cognitive_profiles`, score, signaux, recos ouvertes.
- **`monitor-company-news`** / **`monitor-contacts`** → `company_signals`.
- **`sync-email-analysis`** / **`ingest-transcript`** → extraient par LLM, **au niveau contact** : `person_key_moments` (impact `friction`/`reinforce`/`milestone`) et `person_memory_entries` `entry_type='commitment'` (avec `source_quote`, `source_direction`, `due_date` textuel, `resolved_at`).

### C. Décision de pertinence (aujourd'hui)

- **Signaux** : aucun ranking. Tri `observed_at DESC`, limité à 30. La catégorie (Externe/Vigilance/Friction/Actif/Contexte) est **recalculée côté front par regex** sur le titre/résumé (`V48AccountViews.tsx:256`). La colonne `company_signals.priority` (high/medium/info) existe mais **n'est jamais lue par l'UI**.
- **Recommandations** : `priority DESC`. Mais les priorités **ne sont pas comparables entre catégories** (un `concentration%` de 82 vs un `50+delta` vs un fixe 60 vs un `70−index·5`). Le nombre affiché « prio 92 » est un **entier reproductible mais sans échelle commune ni signification métier unifiée**.

### D. Temporalité (« Depuis votre dernier échange »)

- `t0` = `relationship.lastInteractionAt` est **affiché** mais **pas utilisé pour filtrer**. Le bloc montre `signals[0]`, sans vérifier `observed_at > t0`. **Ce n'est pas un moteur de delta.**
- Aucune notion d'« événement déjà vu » : rien n'empêche un signal ancien de remonter.

### E. Engagements

- **Aucun objet engagement au niveau compte.** Il existe `person_memory_entries[commitment]` (niveau contact) avec :
  - auteur/sens : `source_direction` (approximatif)
  - échéance : **noyée en texte** dans `content` (`« … — échéance 2026-05-01 »`) → non requêtable
  - statut : `open` / `resolved_at` (= tenu). **Pas de `en retard`, `annulé`, `remplacé`.**
- L'« en retard » n'est jamais calculé (pas de due_date structuré). Le cycle demandé (ouvert→échéance→en retard→tenu) **n'existe pas**.

### F. Mémoire du compte

- **Pas de mémoire structurée au niveau compte.** `account_memory_entries` = notes manuelles libres (0 en prod).
- La vraie mémoire structurée est **au niveau personne** : `person_key_moments` (70 lignes) + commitments (20). Elle n'est pas agrégée compte, et n'apparaît dans les 5 blocs **que** via le prompt du LLM reading.

### G. Interactions UI (ce qui est réellement persisté)

| Action | Effet réel | Persisté ? | Réapparaît ? |
|---|---|---|---|
| Stratégie ✓ Fait | `account_recommendations.status='completed'` | ✅ | ⚠️ recréée au prochain `score-batch` si condition tient (dédup ne regarde que les recos *ouvertes*) |
| Stratégie × Pas juste | `status='dismissed'` | ✅ | ⚠️ idem — **confirmé en prod : `risque_concentration` = 4 dismissed + 3 open** |
| Stratégie Reporter | `status='postponed'` (reste affiché) | ✅ | — |
| Avatar « porté par » | `assigned_to` / `assigned_contact_id` | ✅ | — (bien fait) |
| Bouton `i` (Stratégie) | déplie preuve inline (source · date · confiance · « Pourquoi ») | UI locale | — |
| Signal ✓/× | `signal_feedback.verdict` | ✅ | pas de recréation (0 signal en prod) |
| « Voir X de plus » | expand local | non | — |
| lecture_strategique ✓ | `completed` **mais** régénération LLM → `dismiss` du lot + réinsertion `open` → **le ✓ ne survit pas à une régénération** | partiel | ✅ |

### H. Doublons entre blocs

Un **même** `company_signal` peut apparaître **simultanément** dans 4 blocs, avec un texte quasi identique :
1. Signaux récents (`SignalFeed`)
2. Depuis votre dernier échange (spotlight = `signals[0]`)
3. Stratégie de compte (score-batch crée 1 reco `risque` **par signal**, titre = titre du signal)
4. Historique (`momentsFrom` inclut les signaux)

C'est le copier-coller que tu veux éviter : pas de lecture différenciée, juste la même phrase répétée.

### I. Fiabilité (FAIT vs ANALYSE)

- Le socle existe : `provenance` (source_type, source_label, source_url, observed_at, **confidence**, **inference_level** = `manual`/`inferred`/`strong_inference`) est porté partout dans les types.
- Mais l'UI **ne distingue pas visuellement FAIT et ANALYSE**. Une justification de reco (déduction) est affichée comme une phrase neutre. Le `source_quote` verbatim (qui existe pour les commitments) n'est pas remonté. Seule la StrategyCard a un panneau preuve ; Signaux et Insight n'ont pas de disclosure à 4 niveaux.

---

## 2. Ce qui fonctionne bien (à conserver)

1. **Scoring compte** (`score-batch`) : formule explicite, pondérée (0,55 engagement + 0,25 couverture + 0,20 récence), composantes persistées, `snapshot_month` propre, modale d'explication honnête (`ScoreModal`). **Reproductible et explicable.** À réutiliser tel quel.
2. **Provenance partout** : le modèle de données sépare déjà source/date/confiance/niveau d'inférence. Fondation solide pour tracer FAIT vs ANALYSE.
3. **Extraction structurée déjà en place** au niveau contact : `person_key_moments` (impact typé) + commitments (source_quote, direction, resolved_at). **C'est la brique clé du moteur** — elle existe, elle est peuplée (70+20), il « suffit » de l'agréger et la promouvoir au compte.
4. **Lecture stratégique LLM** : bornée aux faits persistés, règle de suffisance (`MIN_EVIDENCE=3`), cache 7j, jamais en boucle, note anti-hallucination. Bon garde-fou.
5. **Cycle de vie des recos** (open/completed/dismissed/postponed) : les colonnes + l'écriture existent (`updateRecommendationStatus`). Le socle d'état est là.
6. **Affectation « porté par »** : réassignation membre/contact propre et persistée.
7. **Gestion sources incomplètes** : la pilule connecteurs distingue connecté/erreur/non connecté, `SignalFeed` affiche « Veille coupée ». L'esprit « absence de donnée ≠ absence d'échange » est amorcé.
8. **Direction visuelle** : cartes aérées, badges, priorité, avatars, dépliants inline, « Voir X de plus » — à garder.

---

## 3. Ce qui fonctionne partiellement (à renforcer)

1. **Catégorisation des signaux** : logique métier correcte (5 familles) mais **recalculée par regex au front** à chaque rendu → fragile, non persistée, diverge du back. À figer côté données.
2. **Priorité des recos** : réelle mais **non normalisée** entre catégories → « prio 92 » n'a pas de sens comparatif. À unifier sur une échelle explicable.
3. **Cycle des recos** : états persistés, mais la **dédup ignore les états terminaux** → un rejet revient. À corriger (mémoire de décision + réactivation seulement sur fait nouveau).
4. **Engagements** : extraits mais non structurés (due_date en texte), non agrégés compte, cycle incomplet. À promouvoir en objet requêtable.
5. **Historique** : mélange signaux + notes, impact par regex, pas de sélection « événements structurants » (affiche tout, tronque à 5). À alimenter par `person_key_moments` agrégés.

---

## 4. Ce qui est faux ou trompeur

1. **« Depuis votre dernier échange » n'est pas un delta temporel.** Il affiche `signals[0]` et colle une date `lastInteractionAt` à côté. Un événement antérieur au dernier échange peut s'afficher comme « depuis ». En prod (`company_signals=0`) il affiche toujours « Aucun nouveau signal ». **Faux moteur.**
2. **« Ce que montrent les échanges » ne montre pas les échanges.** C'est `public_context.description` (firmographie) ou un gabarit sur le lead. Le titre promet une interprétation des échanges qui n'a pas lieu.
3. **« prio 92 » — score crédible sans logique métier unifiée.** Reproductible mais incomparable entre catégories.
4. **Recos rejetées qui reviennent** (prouvé : 4 dismissed + 3 open sur `risque_concentration`). Le ✓/× n'est pas réellement respecté au recalcul.
5. **✓ sur lecture_strategique non durable** : effacé à la régénération (identité de la reco = texte, qui change).
6. **Duplication d'un même signal en 4 endroits** avec texte identique.

---

## 5. Ce qui manque

- Un **moteur commun** produisant des **objets métier** (événement, engagement, décision, risque, opportunité, sujet ouvert, blocage, objection, inconnue, contradiction, échéance, jalon, rôle) **au niveau compte**.
- Un vrai **moteur de delta** (t0 = dernière interaction utilisateur↔compte, puis « qu'est-ce qui a changé/apparu après t0 »).
- Un **ranking de signaux** explicite (Impact × Urgence × Nouveauté × Fiabilité × Actionnabilité × Lien objectif), sensible au **type de relation** (Prospect/Client/Partenaire…).
- Un **cycle de vie des signaux** (nouveau/actif/vu/pris en compte/résolu/ignoré/obsolète) et des **engagements** (ouvert/tenu/en retard/annulé/remplacé/inconnu) — avec `due_date` structuré.
- Une **mémoire d'état** des décisions utilisateur (un rejet ne revient pas sans fait nouveau).
- La **séparation FAIT/ANALYSE** explicite dans l'UI + **disclosure 4 niveaux** (conclusion → contexte → preuves → source originale).
- Un **objet objectif** (« ce qu'on essaie d'obtenir avec ce compte »).
- La **promotion signal→jalon** dans le temps (un signal récent devient mémoire longue).

---

## 6. Doublons & incohérences

- **2 implémentations parallèles de la fiche** : la version rendue (AccountRelationView.tsx + V48AccountViews.tsx) **et** une version antérieure entièrement morte dans `AccountDetailPage.tsx` (composants `Health`, `PeopleMap`, `TeamMemory`, `Recommendations`, `RelationshipBand`, `Memory`, `Firmographics`, `Signals`, `WatchCard`) + `V48AccountRelationView` (défini, jamais importé). **~700 lignes mortes.** Risque : on « améliore » un bloc mort.
- Un signal → 4 blocs (voir §1.H).
- Catégorisation signaux **dupliquée** front/back (regex au front vs `family` au back).
- Deux notions de « santé » (HealthSection riche vs `V48AccountRelationView` mort).

---

## 7. Risques techniques

1. **Tout au page-load** (~16 requêtes) : lourd, et si on ajoute des objets métier ça empire. → prévoir agrégats pré-calculés / RPC.
2. **Regex de catégorisation/impact au front** : divergence silencieuse, non testable end-to-end.
3. **Dédup recos incomplète** → pollution des vues actives.
4. **Identité instable des recos LLM** (clé = texte) → états perdus à la régénération.
5. **`company_signals=0` en prod** : toute la surface « signaux » est actuellement à vide → risque de livrer une refonte qu'on ne peut pas tester sur données réelles sans d'abord réactiver/alimenter la veille **ou** brancher la surface sur la mémoire personne (déjà peuplée).
6. **due_date en texte** : impossible de calculer « en retard » de façon fiable.

---

## 8. Ce qui peut être réutilisé (fondations)

- `score-batch` (scoring + composantes + snapshots) — **tel quel**.
- Modèle `provenance` (source/date/confiance/inference_level) — **socle FAIT/ANALYSE**.
- `person_key_moments` + `person_memory_entries[commitment]` (+ `resolved_at`) — **matière première du moteur** (déjà peuplée).
- `account_strategic_readings` + edge function — pour le bloc « Ce que montrent les échanges » (bien mieux que le gabarit actuel).
- Cycle d'état des recos (`updateRecommendationStatus`) + `signal_feedback`.
- CSS/UI existant (cartes, badges, dépliants, avatars, « Voir X de plus », bouton `i`).
- RPC pattern (`account_health_monthly`) pour exposer des agrégats.

---

## 9. Ce qui doit être créé

1. **Table `account_facts`** (objets métier normalisés au niveau compte) — le cœur du moteur (voir §10).
2. **Un `due_date` structuré** sur les engagements (colonne dédiée, migration + extraction) pour calculer « en retard ».
3. **Table/colonnes de cycle de vie** signaux & engagements (état + `last_seen_at` + `acknowledged_at`).
4. **Mémoire des décisions utilisateur** (un dismiss ne revient pas sans fait plus récent que la décision).
5. **RPC d'agrégation** `account_brain(company_id, since?)` produisant faits + delta, consommée par les 5 blocs.
6. **Fonction de ranking** déterministe, testée, paramétrée par type de relation.
7. **Un objet `account_objective`** (ce qu'on cherche à obtenir).
8. Suppression du code mort (§6).

---

## 10. Architecture cible (minimale, réutilise l'existant)

### Principe : UN moteur, CINQ filtres

```
sources brutes ──(déjà)──► extraction LLM (person_key_moments, commitments)
        │                         │
        │  score-batch            │  (nouveau) promotion + agrégation compte
        ▼                         ▼
  score snapshots        ┌─────────────────────────────┐
        └───────────────►│   account_facts (mémoire     │
  company_signals ──────►│   structurée du compte)      │
                         │  type · statut · dates ·     │
                         │  provenance · confiance ·    │
                         │  liens · état                │
                         └──────────────┬──────────────┘
                                        │ RPC account_brain(company, since=t0)
             ┌──────────────┬───────────┼───────────┬────────────────┐
             ▼              ▼           ▼           ▼                ▼
   Ce que montrent   Depuis dernier  Signaux    Stratégie      Historique
   (situation dom.)  (delta > t0)    (ranking)  (actions)      (jalons)
```

### `account_facts` — objet unique, discriminé par `fact_type`

Colonnes clés : `id, organization_id, company_id, fact_type` (`objective|event|decision|commitment|open_topic|blocker|objection|risk|opportunity|unknown|contradiction|deadline|milestone|role`), `title, detail, status` (`new|active|seen|acknowledged|resolved|ignored|obsolete`), `impact` (friction/reinforce/milestone/neutral), `owner_contact_id/owner_user_id`, `subject_contact_id`, `due_at` (structuré), `occurred_at`, `first_seen_at`, `last_seen_at`, `resolved_at`, `superseded_by`, `source_type, source_label, source_url, source_excerpt` (verbatim = **FAIT**), `confidence, inference_level` (déduit = **ANALYSE**), `dedup_key`.

Alimentation (déterministe d'abord, LLM en complément) :
- **Promotion** des `person_key_moments` → `event`/`milestone` au compte (jointure via contact→company).
- **Promotion** des commitments → `commitment` (avec `due_at` structuré ; `en retard` = `due_at < now AND resolved_at IS NULL`, calculé, jamais stocké figé).
- **score-batch** écrit `risk`/`opportunity` (concentration, tension, phase) en `account_facts` (au lieu de recos jetables).
- `company_signals` **mappés** en `event`/`risk`/`opportunity` (dédup via `dedup_key`).

### Les 5 blocs = 5 requêtes sur le même moteur

1. **Ce que montrent les échanges** → 1 phrase de situation dominante (réutiliser `account_strategic_readings.synthese`, pas le gabarit) + « Pourquoi ? » = les `account_facts` qui l'étayent.
2. **Depuis votre dernier échange** → `account_facts WHERE last_seen_at > t0 OR occurred_at > t0`, trié par pertinence, **1 en tête** + « Voir X autres ». Vide → « Aucun changement significatif… sur les sources connectées ».
3. **Signaux récents** → `account_facts` actionnables, **ranking** `pertinence = f(impact, urgence(due_at), nouveauté(first_seen_at), fiabilité(confidence), actionnabilité(fact_type), lien_objectif)` pondéré **par type de relation**. 3–4 + « Voir X de plus ». Le score affiché = ce `pertinence` (0–100), documenté.
4. **Stratégie de compte** → 1–3 `account_facts` de type action (dérivés de risk/opportunity/blocker/deadline + objectif). Badges = taxonomie limitée. Disclosure 4 niveaux. ✓ = `status=acknowledged` (ne revient pas sans fait `last_seen_at` postérieur à la décision) ; × = `status=ignored` + raison optionnelle.
5. **Historique & mémoire** → `account_facts WHERE fact_type IN (milestone, decision, event structurant)` triés date. Un signal résolu **sort** des vues actives mais **reste** ici (promotion signal→jalon = changement de `status`, pas de duplication de texte).

### Découpage déterministe vs LLM

| Rôle | Moteur |
|---|---|
| Delta temporel, cycle de vie, « en retard », ranking, dédup, promotion signal→jalon | **déterministe (SQL/TS testé)** |
| Extraction faits/engagements/moments depuis les échanges | **LLM (déjà en place, sync-email-analysis)** |
| Situation dominante + synthèse « Pourquoi » | **LLM borné (account_strategic_readings, cache)** |
| Mémoire incrémentale (ne pas rejouer toute l'histoire à chaque page-view) | `account_facts` + `last_seen_at` |

### Anti-doublon (règle d'or)

Un `account_fact` = **un** objet. Chaque bloc en fait une **lecture différente** (situation / delta / attention / action / mémoire) — jamais le même texte recopié.

---

## Ordre d'exécution proposé (Phases 3→9)

3. Schéma cible minimal : `account_facts` (+ `due_at` structuré sur commitments) + RPC `account_brain`.
4. Plan par fichier : services d'agrégation (promotion moments/commitments/signaux), fonction de ranking testée, adaptation `getAccountDetail`.
5. Implémentation back (déterministe) puis branchement des 5 blocs sur le moteur.
6. Migration : backfill `account_facts` depuis moments/commitments/signaux existants.
7. Tests unitaires : ranking, delta, cycle engagement (ouvert→retard→tenu), dédup, décisions persistées.
8. Tests par profil : compte riche / pauvre / sans changement / engagement retard puis tenu / reco validée / source non captée / multi-contacts / Prospect·Client·Partenaire.
9. Nettoyage code mort + rapport final.

**Décisions produit — tranchées le 2026-09-14 :**

- (a) **« Ce que montrent les échanges » = hybride** : squelette déterministe (état dérivé de `account_facts` : phase, décideur unique, adoption, engagements ouverts…) habillé par une phrase LLM courte et bornée. Le « Pourquoi » remonte les faits qui étayent la situation.
- (b) **Source signaux = les deux en parallèle** : promotion de `person_key_moments` + commitments (déjà peuplés) **et** réactivation `monitor-company-news`/`monitor-contacts`. Les deux atterrissent dans `account_facts` (dédup commune).
- (c) **Objectif du compte = objet versionné, jamais imposé, jamais présumé vrai :**
  - Table/colonnes : `objective` avec `source ∈ {user, inferred, crm}`, `confidence`, `status ∈ {inferred, confirmed_by_user}`, `updated_at`, historique des changements.
  - **Priorité** : un objectif `source=user` (ou `crm` confirmé) **gagne toujours** sur l'inféré.
  - Sinon le moteur **propose** un objectif `inferred` (déduit de type relation + phase + opportunité ouverte + dernière décision + engagements + sujets actifs) — affiché **comme hypothèse**, jamais comme vérité.
  - L'utilisateur corrige en 1 clic → bascule en `confirmed_by_user`.
  - **L'objectif évolue dans le temps** (prospect : « premier RDV » → « valider budget » → « signature ») : on garde l'historique, le ranking utilise l'objectif courant.

Modélisation retenue : un `account_facts` de `fact_type='objective'` (réutilise statut/source/confiance/dates du modèle commun) plutôt qu'une table séparée — l'évolution = nouvelles lignes + `superseded_by`, l'objectif courant = le plus récent non superseded.
