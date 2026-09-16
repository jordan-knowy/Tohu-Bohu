# RAPPORT FINAL — Moteur Compte + Scoring V6 + Pertinence

## VERDICT EN 3 CATÉGORIES (mise à jour finale 2026-09-15)

### ✅ TERMINÉ ET PROUVÉ (données réelles, testé)
- **Scoring V6 pur** : dyade (55), Météo compte (33), snapshots (fiabilité/P5/P7/statut), rejeu mensuel. 
- **Détecteurs déterministes** S04/R01/R02/A01/A02 → `scoring.marker_event` (shadow), **idempotents** (rejeu = 0). Prouvé sur 3 dyades réelles.
- **Mémoire M2 généralisée à l'organisation** : RPC `promote_account_facts` → **47 facts sur 5 comptes** (29 nouveaux), **idempotent** (rejeu = 0), **0 fact sans preuve**, échéances parsées. Consistance SQL↔TS prouvée (Limayrac skippé).
- **Réconciliation** : RPC `reconcile_account_facts`/`reconcile_marker_events` → source disparue ⇒ `obsolete`/`deprecated_at` (audit conservé, sort du scoring). **Prouvé sur données réelles** (fait témoin → obsolète, réels intacts, `account_brain` reflète).
- **account_brain** (RPC) : compréhension serveur, états de disponibilité, kind fait/inférence/synthèse. **E2E vérifié sur 5 profils réels** (riche/vide/partiel → états honnêtes, aucune fabrication).
- **Relevance engine** : dimensions dérivées des facts → priorité + breakdown ; état permanent ≠ signal. Testé.
- **Refonte front de la fiche Compte — RÉELLEMENT terminée (2026-09-15)** : vérification du chemin actif réel (`/app/accounts/:accountId` → `AccountDetailPage` → `AccountRelationView`/`V48AccountLiveView`) a montré que le shell (max-width 1320px, header, breadcrumb, RelationChip, owner/visibilité, bouton+drawer Coordonnées), le design-token system (violet `#6E50C8`/ink `#1A1040`/lavande/positive-warning-négatif, transitions 160ms + `prefers-reduced-motion`), les primitives de preuve (`SourceBadge`/`EvidenceItem`/`EvidenceKindBadge`, FAIT/ANALYSE TOHU/INFÉRÉ/À CONFIRMER), l'Organigramme (liens réels vers la fiche Personne), la Vue Signaux (agent de veille, signaux 4+« voir plus », firmographie repliable) et le responsive existaient déjà et satisfaisaient le brief. Le vrai manque était l'intégration des données V6 dans la Vue Relation elle-même (elles vivaient dans un onglet « V6 · shadow » séparé et redondant) : ajout de `Météo du compte` (6 cadrans interactifs explicables, `src/account-detail/AccountWeatherV6.tsx`), `Ce qui a changé récemment` et `Engagements`, positionnés dans l'ordre exact du brief (Où on en est → Météo → Ce qui a changé récemment → Organigramme → Santé/historique → Engagements → Ce qu'il faut faire → Mémoire relationnelle), gated par `scoring_v6_ui`. L'onglet « V6 · shadow » et `AccountBrainV6View.tsx` sont supprimés (fonctionnalité absorbée) — la fiche a maintenant exactement 2 onglets (Relation/Signaux), conforme au brief. `tsc --noEmit` et `npm run build` clean.
- **Correctif de fond découvert et corrigé en marge de ce travail** : le bouton × de « Ce qu'il faut faire » faisait un rejet GLOBAL (`account_recommendations.status='dismissed'`) au lieu d'un masquage personnel — en contradiction avec la doctrine de cette session (× = per-user). Corrigé : × écrit maintenant dans `account_recommendation_user_state` (comme prévu depuis M1 mais jamais câblé côté Vue Relation) ; une action « Non pertinent pour ce compte » distincte fait le rejet d'équipe réel. `getAccountDetail` filtre désormais les recos masquées pour l'utilisateur courant. Fichiers : `service.ts` (`dismissRecommendationForMe`, `markRecommendationNotRelevant`), `AccountRelationView.tsx`.
- **Correctif dédup recos — DÉPLOYÉ (2026-09-15)** : trigger `account_rec_dedup_guard_trg` (BEFORE INSERT sur `public.account_recommendations`), flag-gated (`scoring_v6_dedup`, mode `orgs`, actif uniquement sur les 2 organisations témoins). Empêche une reco **terminale** (`completed`/`dismissed`) de revenir sans nouveau fait significatif postérieur (fait précis si `origin_fact_id` renseigné, sinon repli honnête = tout fait actif du compte postérieur à la terminaison — les producteurs actuels, `score-batch` et `account-strategic-reading`, ne renseignent pas encore `origin_fact_id`). × reste strictement per-user (`account_recommendation_user_state`). Rejet global = uniquement via l'action UI « Non pertinent pour ce compte » (`service.ts::markRecommendationNotRelevant`, écrit `status='dismissed'` + `feedback_reason='not_relevant_for_account'`). Rollback immédiat = `UPDATE feature_flags SET enabled=false WHERE key='scoring_v6_dedup'`. **Testé sur données réelles avant/après** (transaction de test, rollback, aucune donnée persistée) : cas bloqué (aucun fait nouveau → 0 ligne insérée), cas autorisé (fait nouveau postérieur → 1 ligne insérée), gate non-témoin (`flag_enabled_for_org` → `false` pour une org hors liste). Migration locale : `supabase/migrations/20260915100000_rec_dedup_guard_flagged.sql`.
- **Tests** : 319 verts (+ 8 échecs `sync-slack` PRÉ-EXISTANTS, hors périmètre), `tsc` clean, `npm run build` clean.

### 🟡 PRÊT MAIS EN SHADOW / FEATURE FLAG (volontairement non autoritaire)
- **Sections Météo/Ce qui a changé récemment/Engagements** derrière `scoring_v6_ui` (2 orgs témoins) — intégrées à la Vue Relation, lecture seule, legacy reste autoritaire pour le score.
- **Météo V6 sur compte réel — honnêtement PAS ENCORE observable** : `scoring.score_snapshot` (entity_type='account') est vide, aucun snapshot compte jamais persisté. Investigation : le calcul compte nécessite `AccountDyadInput.authority` (poids Décideur 1.0/Influenceur 0.6/Utilisateur 0.3/Filtre 0.2), qui dépend d'une qualification de rôle (`account_contact_roles.decision_role`) **absente à 100 % sur les deux organisations témoins** — donnée réellement manquante, pas un bug. 3 des 6 cadrans (Équilibre/Ancrage/Dynamique) seraient calculables sans rôle (volumes de messages, porteurs internes, cadence — données réelles disponibles), mais la couche fiabilité (`buildAccountWeatherSnapshot` attend un `dialReliabilities` par cadran) n'a jamais été spécifiée pour le niveau compte au-delà des dyades — je n'ai pas inventé cette formule plutôt que de fabriquer une précision qui n'existe pas. **Conséquence honnête** : la section Météo de la Vue Relation (`src/account-detail/AccountWeatherV6.tsx`) est réelle et testée (rendu des 6 cadrans + règle d'affichage fiabilité `displayRule`, logique vérifiée via les tests `calculateAccountWeatherCore`/`snapshots` sur les fixtures de référence Météo=33), mais affiche honnêtement `insufficient_data` sur tout compte réel aujourd'hui — jusqu'à une décision produit sur `dialReliabilities` compte + une qualification minimale des rôles.
- **marker_event / score_snapshot V6 (dyade)** : peuplés en shadow, non lus par la fiche legacy.
- **Classificateur sémantique** : edge function `classify-markers` **déployée (ACTIVE)** + cœur pur **testé (9 tests)** ; opère sur les extraits dérivés (registre fermé, verbatim S07, candidate si doute). Mécanisme d'invocation entièrement câblé et documenté (cf. §Classificateur ci-dessous) ; seul le déclenchement effectif (cron/app) reste externe à cet environnement.

### 🔴 BLOQUÉ PAR SOURCE / OUTILLAGE EXTERNE (réellement impossible ici)
- **Run live du classificateur** : je ne peux pas **invoquer** une edge function ni appeler l'API LLM depuis cet environnement (pas d'outil d'invocation / pas d'accès clé). La fonction est déployée et testée ; **un appel (cron/app) la fait tourner**. Mécanisme entièrement documenté ci-dessous (§Classificateur — mécanisme d'invocation) pour que le déclenchement externe soit une simple exécution, pas une inconnue. → *tooling, pas code.*
- **C02** (largeur cc), **C03/S01** (formalité/hedging) : corps d'emails non stockés (`analyzed_without_body_storage`).
- **K02/K04/K08** : facturation / bounce / preuve contractuelle absentes.
- **Météo compte sur données réelles** : voir §🟡 ci-dessus — qualification des rôles interlocuteurs absente (donnée), pas un bug de calcul.
- Pour chacun : marqueur → source nécessaire → source absente → conséquence → à connecter ultérieurement (cf. §Détecteurs).

### Ask Bohu (constat, pas une régression)
`BohuBar.tsx`/`AskPage.tsx`/route `/app/ask` non touchés par ce chantier — aucune régression possible. Constat honnête distinct : Ask Bohu n'est aujourd'hui couplé à AUCUN `account_id` ni contexte compte (ni avant ni après ce chantier) — c'est un chat à portée globale (organisation/comptes/contacts). La fiche Personne a un lien contextualisé (`/app/ask?mode=simulation&personId=...`) ; un équivalent côté compte serait une fonctionnalité nouvelle, non demandée explicitement dans ce chantier.

## Classificateur — mécanisme d'invocation (documentation, non bloquant pour la suite)
Le run live est hors de portée de cet environnement (pas d'invocation d'edge function ni d'appel LLM direct). Voici le mécanisme réel, tel que déployé, pour qu'un déclenchement externe (cron/app) soit une exécution directe sans ambiguïté :

- **Endpoint** : `POST {SUPABASE_URL}/functions/v1/classify-markers` (fonction Deno déployée, id `b4d99ade-9d2e-4046-8c2a-ab715b362bca`, statut ACTIVE, version 1).
- **Authentification** : header `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}` (ou un JWT utilisateur avec droits suffisants — la fonction utilise en interne le service role pour lire `person_key_moments`/`person_memory_entries` et écrire dans `scoring.marker_event`, RLS contournée côté fonction). Variable d'environnement requise côté fonction : `OPENROUTER_API_KEY` (déjà configurée, sinon 500 `OPENROUTER_API_KEY non configurée`). Modèle configurable via `OPENROUTER_ANALYSIS_MODEL` (défaut `google/gemini-3.1-flash-lite`).
- **Payload** (JSON) : `{ "organizationId": "<uuid, requis>", "companyId": "<uuid, optionnel — filtre à un compte>", "limit": <int, optionnel, défaut 40, plafonné à 100> }`. Sans `organizationId` → 400.
- **Cadence recommandée** : run périodique (ex. cron horaire ou quotidien) par organisation active, avec `limit` modéré (40-100) pour rester dans les quotas OpenRouter et le budget de temps d'exécution Edge Function ; peut aussi être déclenché à la demande (bouton « Analyser » côté app) avec `companyId` pour un compte précis.
- **Idempotence** : garantie par la base, pas par l'appelant. Chaque extrait produit une `dedup_key` déterministe `sem:{marker_id}:{extract_id}` ; l'insertion dans `scoring.marker_event` porte un index unique partiel sur `(organization_id, dedup_key) WHERE dedup_key IS NOT NULL`. Un ré-appel sur les mêmes extraits ne duplique rien : le code Postgres `23505` (violation d'unicité) est intercepté et traité comme un succès silencieux (déjà présent), pas une erreur.
- **Comportement en erreur** : erreur réseau/HTTP vers OpenRouter (`!res.ok`) ou JSON invalide → extrait traité comme `NO_MARKER` (compte dans `no_marker`, aucune écriture) plutôt que de faire échouer tout le run — un extrait individuellement en échec ne bloque jamais les suivants (boucle `for` séquentielle, pas de `Promise.all` qui propagerait un rejet).
- **Retry** : aucun retry automatique intégré (par design — un extrait manqué sera retenté au prochain run planifié, sans risque de duplication grâce à `dedup_key`). Un retry applicatif immédiat est possible côté appelant (relancer le même payload) sans risque, l'idempotence étant garantie en base et non par l'appelant.
- **Anti-doublon** : deux mécanismes complémentaires — (1) `dedup_key` unique en base (ceinture), (2) le classificateur ne lit que les extraits déjà dérivés (`person_key_moments.summary`, `person_memory_entries.source_excerpt` où `entry_type='commitment'`), donc un même extrait source produit toujours la même `dedup_key` quel que soit le nombre de runs (bretelle).
- **Vérification du résultat en base** : la réponse HTTP renvoie `{ analyzed, accepted, candidates, no_marker, inserted }` (compte de chaque catégorie). Vérification indépendante possible par SQL : `select count(*) from scoring.marker_event where organization_id = :org and source = 'classifier:extract' and detector_version = 'semantic-classifier-v1'` (et filtrer `is_candidate` pour distinguer accepté/candidat).

### Comparaison finale Legacy ↔ V6
Inchangée depuis la 1re : legacy **absent** (cognitive_profiles vide sur les dyades témoins) vs V6 **partiel** (reliability 0.06–0.24, verdict refusé P7). La comparaison enrichie (post-classificateur) nécessite le run live (bloqué outillage). **Jamais de convergence artificielle.**

---



> Rapport de clôture (2026-09-14). Doctrine tenue : **absence honnête > invention.**
> Ce document donne le verdict réel : ce qui est terminé, prouvé sur données
> réelles, encore en shadow, prêt/non prêt pour la production — et pourquoi.
> Docs de détail : [SCORING_DOCTRINE.md](SCORING_DOCTRINE.md), [AUDIT_SCORING_V6.md](AUDIT_SCORING_V6.md),
> [SCORING_V6_S0_DESIGN.md](SCORING_V6_S0_DESIGN.md), [AUDIT_MOTEUR_COMPTE.md](AUDIT_MOTEUR_COMPTE.md),
> [DESIGN_MOTEUR_COMPTE.md](DESIGN_MOTEUR_COMPTE.md), [FINAL_ACCOUNT_ENGINE_V6_REPORT.md](FINAL_ACCOUNT_ENGINE_V6_REPORT.md).

## Architecture finale
```
PIPELINE RELATIONNEL (scoring V6)
sources réelles (communication_messages, meetings)
  → détecteurs déterministes (P4 baseline + S04/R01/R02/A01/A02)      [+ classificateur sémantique : déployé, run live hors environnement, cf. §Classificateur]
  → scoring.marker_event (evidence+date NOT NULL, dedup_key, is_candidate)   ← idempotent, candidats hors score
  → calculateDyadScoreCore / calculateAccountWeatherCore (PUR, 55/33)
  → buildDyadScoreSnapshot (fenêtre + P5/P7 + fiabilité + statut cadence)
  → scoring.score_snapshot (reproductible, versionné)

PIPELINE MÉMOIRE / ACTION
sources → account_facts (M2, promotion fidèle) + evidence
  → public.account_brain (RPC : agrège, états de disponibilité, kind fait/inférence/synthèse)
  → relevance (deriveDimensions → computeRelevance → priority + breakdown)
  → contrat UI (AccountBrainDTO, rankSignals/rankDelta)
  → Vue Relation réelle (Météo/Ce qui a changé récemment/Engagements, src/account-detail/AccountWeatherV6.tsx) — derrière scoring_v6_ui
```
Les deux pipelines partagent les preuves, **jamais** les scores.

## Modifications (fichiers importants)
**Scoring pur (`src/services/scoring/`)** : `types.ts`, `registry-v6.ts` (34 marqueurs + params), `calculateDyadScoreCore.ts`, `calculateAccountWeatherCore.ts`, `snapshots.ts` (fiabilité/P5/P7/statut/displayRule), `replay.ts`, `detectors.ts` (P4 + S04/R01/R02/A01/A02/E05-candidate).
**Pertinence (`src/services/relevance/`)** : `computeRelevance.ts` (params v1), `deriveDimensions.ts`.
**account_brain (`src/services/account-brain/`)** : `accountBrain.ts` (DTO + rankSignals/rankDelta + fetch).
**Divers** : `src/lib/featureFlags.ts`, `src/services/recDedup.ts` (correctif dédup recos, pur).
**Mémoire (M2)** : `supabase/functions/_shared/promote-facts.ts`.
**UI fiche Compte (`src/account-detail/`)** : `AccountWeatherV6.tsx` (nouveau — Météo/Ce qui a changé récemment/Engagements), `AccountRelationView.tsx` (sections V6 intégrées + correctif × per-user/global), `AccountDetailPage.tsx`/`AccountHeader.tsx` (2 onglets, suppression de l'onglet V6 shadow), `service.ts` (`dismissRecommendationForMe`, `markRecommendationNotRelevant`, filtre per-user), `src/styles/account-brain-v6.css` (styles cadrans/changement récent/engagements). `AccountBrainV6View.tsx` supprimé (absorbé).
**Tests** : `src/services/**/__tests__/*` (21 fichiers).

## Migrations (toutes additives / réversibles)
| Migration | Fonction | Réversible |
|---|---|---|
| `account_facts_engine_m1` | mémoire compte (account_facts + evidence + user_state + recos additives) | oui (drop tables/cols) |
| `scoring_v6_shadow_schema` | schéma isolé `scoring` (registry/params/marker_event/score_snapshot) + RLS | oui (`drop schema scoring`) |
| `scoring_v6_seed_registry_params` | seed reg-v6.0 (34 marqueurs) + params palier/spec | oui (delete rows) |
| `feature_flags` | table de rollout (5 flags OFF) | oui |
| `marker_event_dedup_and_candidate` | dedup_key (unique) + is_candidate | oui |
| `account_brain_rpc` (+fix) | RPC de compréhension serveur | oui (drop function) |
| `reconciliation_rpcs` | `reconcile_account_facts`/`reconcile_marker_events` | oui (drop functions) |
| `promote_account_facts_rpc` (+fix) | M2 généralisé à l'organisation | oui (drop function) |
| `rec_dedup_guard_flagged` | trigger dédup recos + `scoring_v6_dedup` flag (2 orgs témoins) | oui (drop trigger/function, flag off) |
**Aucune migration destructive. Legacy scoring intact.**

## Scoring — état final du moteur V6
Déterministe, pur, versionné, explicable. **Tests de référence : personne = 55, compte = Météo 33.** Modes Palier/Spec, répétition, décroissance par magnitude, volontarité (+ Exécution), plafonds S07/K06/K01, autorité, HHI, redistribution des cadrans null, base 50 (jamais 50 fabriqué pour une absence → null via P5). Fiabilité + statut cadence + P7 dans la couche snapshot. Rejeu mensuel escalier, delta 30 j, reproductible à versions identiques.

## Détecteurs — couverture exacte par marqueur
| Marqueur | Statut | Détail |
|---|---|---|
| S04 | **done** (déterministe) | relances ≥2× sans réponse (threads réels) |
| R01 | **done** | latence contact vs baseline P4 (jamais un seuil absolu) |
| R02 | **done, `candidate`** | initiation ; substance non mesurable sans contenu |
| A01, A02 | **done** | diversité de canaux / continuité trimestrielle |
| E05 | **`candidate_only`** | réunion tenue ; `response_status` = uniformément `needsAction` (accept/decline non capté) |
| C02 | **blocked_by_missing_source** | largeur de cc non captée (metadata: from/to seulement) |
| C03, S01 | **blocked_by_missing_source** | corps non stocké (`analyzed_without_body_storage`) |
| C01, C05, S03, S06, S07, S08, E01–E04 | **blocked_by_missing_source (raw) / remaining (dérivé)** | classificateur sémantique : voir ci-dessous |
| K02, K04, K08 | **blocked_by_missing_source** | facturation / bounce / preuve contractuelle absentes |
| K01, K03, K05, K06, K07, K09 | **remaining / blocked** | mixte contractuel + sémantique |

## Classificateur sémantique — fonctionnement, garde-fous, LIMITE bloquante
**Non déployé — blocage réel de source.** Un classificateur sur le **texte brut** des emails est impossible : les **corps ne sont pas stockés** (`communication_messages.metadata = analyzed_without_body_storage`). C'est un `blocked_by_missing_source` au sens des conditions d'arrêt autorisées (« source indispensable absente »).
Variante réalisable (non faite, budget) : classifier les **extraits déjà dérivés** (`person_key_moments.summary`, `person_memory_entries[commitment].source_excerpt`) via un registre **fermé** (C01/C05/S03/S06/S07/S08/E01–E04), sortie stricte `{marker_id|NO_MARKER, observed_at, sense, evidence_ref, evidence_text, confidence, detector_version}`, **jamais un score** ; S07/K06 → verbatim obligatoire + `candidate_only` si doute. Design figé, prêt à implémenter comme edge function.

## Données réelles
- Wiring exécuté sur **3 dyades témoins** (org a4a85f3e, company e15f709c), **1048 messages** analysés, **7 marker_events** persistés en shadow (S04/A01/A02), **0 candidat scoré**. R01/R02 = 0 (données antérieures à mai 2026 → baseline récente vide, honnête).
- M2 mémoire : **18 account_facts / 18 evidence** sur Limayrac (témoin validé).

## Idempotence
- `marker_event` : rejeu = **0 nouveau** (unique `dedup_key` + ON CONFLICT).
- M2 : rejeu = 0 nouveau fact / 0 evidence (18 noop).
- Correctif dédup recos : logique pure testée (rejet ne revient pas sans fait postérieur ; × per-user ≠ rejet d'équipe). **Non déployé dans score-batch** (changement de comportement prod → fenêtre de test dédiée requise).

## Réconciliation (sources supprimées / modifiées)
**NON implémentée** (`implementation_remaining`). Le socle existe (`marker_event.deprecated_at`, `account_facts.status='obsolete'`, `superseded_by`) mais aucun job ne rétracte encore un dérivé quand sa preuve disparaît, ni ne recalcule le snapshot correspondant. C'est un pré-requis explicite avant toute bascule UI de lecture — documenté, non contourné.

## Legacy ↔ V6 (comparaison finale)
Sur les 3 dyades témoins : **legacy absent** (`cognitive_profiles` vide pour ces contacts) vs **V6 partiel** (44/53/49). Axes C/E/R = base 50 (aucun marqueur), Ancrage/Satisfaction portés par A01/A02/S04. **reliability 0.06–0.24**, **verdict_allowed = false** (P7 < 5 marqueurs). Divergence documentée, **jamais réconciliée artificiellement**. Le moteur dit correctement « insuffisant ».

## Reliability — distribution & cas refusés
Formule provisional (couverture×volume×identité×diarisation, plafond X01). Sur les témoins : 0.06 à 0.24 → **tous sous 0.50** → `displayRule` = `score_greyed_no_verdict`. P7 refuse le verdict partout (< 5 marqueurs). Aucune précision artificielle produite.

## account_brain — entrées / sorties / logique
**Entrée** : (organization_id, company_id, user_id). **Contrôle** : `can_view_company` (auth.uid non nul). **Sortie JSON** : `account`, `weather` (available|insufficient_data), `dimensions` (insufficient_data), `situation` (synthèse typée), `delta_since_last` (t0 **personnel**, `no_personal_interaction` sinon + dernier échange équipe), `active_facts`, `engagements`, `recommendations` (+priority_breakdown), `history`, `availability{}`. Chaque fait porte `kind` (observed_fact/inference/deterministic/synthesis). **Vérifié sur Limayrac** : 17 active_facts, 3 engagements, 2 recos, 16 history, weather insufficient_data. Ne fabrique jamais une dimension absente.

## Relevance — fonctionnement & tests
`deriveDimensions(fact, relationType)` → 6 dimensions justifiées (impact/urgence/nouveauté/fiabilité/actionnabilité/lien-objectif) → `computeRelevance` (somme pondérée v1 provisional, pas de produit) → `priority` 0-100 + `breakdown`. `rankSignals`/`rankDelta` classent les faits d'`account_brain` ; état permanent déprioritisé (§37) ; priorité ≠ gravité. **Testé** (un engagement en retard lié passe devant un vieil événement neutre ; delta trié).

## UI — blocs réellement connectés
**Contrat backend prêt** (AccountBrainDTO + rankSignals/rankDelta, testés). **Rendu React NON câblé** (`implementation_remaining`) : aucune bascule UI, conforme à « pas de bascule tant que shadow non stable ». La fiche actuelle (legacy) est inchangée. Les 5 blocs + Météo UI + phrase du jour + feedback restent à câbler sur `account_brain` derrière `scoring_v6_ui`.

## Tests
**145 tests unitaires verts** (`src/services`, `src/lib`), `tsc --noEmit` clean. Vérifications sur **données réelles** : wiring marker_event + idempotence + comparaison legacy↔V6 + account_brain sur Limayrac. Les 8 échecs `sync-slack` sont **pré-existants** (module non touché). **E2E multi-profils : non exécutés** (dépendent du rendu UI).

## Risques ouverts
1. **Réconciliation absente** → un dérivé peut survivre à sa preuve : à corriger **avant** toute lecture UI V6.
2. **Couverture marqueurs faible** (corps absents) → V6 restera « insuffisant » sur beaucoup de dyades tant que le classificateur (sur extraits) n'est pas branché.
3. **Correctif dédup score-batch non déployé** → recos rejetées peuvent encore revenir en prod legacy.
4. Fraîcheur des données témoins (< mai 2026) → baselines récentes vides.

## Dette technique (n'empêche pas l'usage)
Local/remote : `account_brain` appliqué via MCP + sauvegardé en fichier (parité OK). ~700 lignes mortes (`AccountDetailPage.tsx`, `V48AccountRelationView`) **non supprimées** (nettoyage post-bascule). Fixtures de wiring dans le scratchpad (non versionnées, normal).

## VERDICT FINAL
| Domaine | Verdict |
|---|---|
| Scoring V6 (cores, snapshots, replay, fiabilité, P5/P7) | **TERMINÉ + testé** (55/33) |
| Mémoire M2 (account_facts) | **TERMINÉ**, témoin réel validé ; généralisation org **remaining** |
| Détecteurs déterministes (S04/R01/R02/A01/A02) | **TERMINÉ + vivant sur données réelles** (shadow) |
| Classificateur sémantique | **BLOQUÉ** (corps non stockés) ; variante sur extraits **remaining** |
| marker_event shadow + idempotence | **TERMINÉ + prouvé** |
| Legacy ↔ V6 | **comparé, divergence honnête** (V6 partiel/insuffisant, attendu) |
| Relevance engine | **TERMINÉ + testé** (moteur + wiring account_brain) |
| account_brain | **TERMINÉ + vérifié** sur données réelles |
| Contrat UI | **TERMINÉ** (DTO + ranking) |
| Rendu UI (5 blocs + Météo) | **REMAINING** (front non câblé) |
| Réconciliation sources supprimées | **REMAINING** (bloquant avant lecture UI) |
| E2E multi-profils | **REMAINING** (dépend du rendu UI) |
| Nettoyage code mort | **REMAINING** (post-bascule) |

**Prêt pour la production ?** **NON — et c'est le comportement correct.** Le moteur V6 tourne **en shadow**, prouvé de bout en bout côté **backend** (source→détecteur→marker_event→score→snapshot→account_brain→relevance→contrat UI) sur données réelles, avec garde-fous honnêtes (insuffisant/null/verdict refusé). Il **n'est pas** prêt à remplacer le legacy en prod car : (a) la couverture de marqueurs est trop faible sans le classificateur (bloqué par l'absence des corps), (b) la réconciliation des preuves supprimées n'existe pas encore, (c) le rendu UI n'est pas câblé. **Legacy reste autoritaire en production**, désactivable/activable via `feature_flags` le jour où (a)(b)(c) sont levés. Aucune donnée de score fabriquée ; toute absence est explicite.
