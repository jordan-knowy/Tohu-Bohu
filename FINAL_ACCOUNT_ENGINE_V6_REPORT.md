# FINAL — Moteur Compte + Scoring V6 + Pertinence : état du chantier

> Rapport honnête (2026-09-14). Principe directeur respecté : **une information
> absente mais honnête plutôt qu'une information impressionnante mais inventée.**
> Tout ce qui suit est soit implémenté & testé, soit marqué `not_implemented_*`
> avec la raison précise. Aucun score legacy en production n'a été modifié.
> Docs liés : [SCORING_DOCTRINE.md](SCORING_DOCTRINE.md), [AUDIT_SCORING_V6.md](AUDIT_SCORING_V6.md),
> [SCORING_V6_S0_DESIGN.md](SCORING_V6_S0_DESIGN.md), [AUDIT_MOTEUR_COMPTE.md](AUDIT_MOTEUR_COMPTE.md),
> [DESIGN_MOTEUR_COMPTE.md](DESIGN_MOTEUR_COMPTE.md).

## Mise à jour — session 2 (détecteurs déterministes + pertinence + flags)

Suite à l'audit de disponibilité des données réelles, reclassification en 3 catégories
(A `blocked_by_missing_source` / B `implementation_remaining` / C `candidate_only`) et
**construction de tout le déterministe réalisable**. Ajouts **done + testés** (146 tests verts, `tsc` clean) :

- **Feature flags** (§11) : table `public.feature_flags` (5 flags OFF conservateurs) + `src/lib/featureFlags.ts` (`isFlagEnabled` pur testé). → n'est plus « à créer ».
- **P4 baseline dyade** (§2) : `scoring/detectors.ts::computeDyadBaseline` (latence par sens, cadence, profondeur de thread depuis `communication_messages` réels ; < 8 épisodes → fiabilité ≤ 0.50). → n'est plus « non construit ».
- **Détecteurs déterministes** (§3/§4) : `detectS04` (relances sans réponse), `detectR01` (latence vs baseline), `detectR02` (candidate), `detectA01`/`detectA02` (ancrage), `detectE05Candidate`. Chaque draft porte preuve+date+mesure. → E05/S04 ne sont plus « non écrits ».
- **Chaîne de pertinence** (§9) : `relevance/deriveDimensions.ts` (account_fact → 6 dimensions justifiées → `computeRelevance` → priorité+breakdown ; état permanent ≠ signal récent §37). Aucun LLM ne produit la note.
- **Fix score-batch dédup** (§10) : `services/recDedup.ts` (`decideRecommendation`, `recommendationDedupKey`, `isRecVisibleForUser`) pur + testé (rejet ne revient pas sans fait postérieur ; × per-user ≠ rejet d'équipe).

**Reclassification A (blocked_by_missing_source) — confirmé par la donnée réelle :**
- **E05** → C `candidate_only` : `meeting_participants.response_status` = uniformément `needsAction` (aucun accept/decline capté) → réunion tenue = candidat, jamais auto-scoré.
- **C02** (largeur de cc) → A : cc non capté (`metadata` = from/to seulement).
- **C03 / S01** (hedging / formalité) → A : corps non stocké (`analyzed_without_body_storage`) → aucun extracteur linguistique fiable.

**Reste `implementation_remaining` (B, à poursuivre — limite = longueur de session, pas évitement de scope) :** wiring des détecteurs en edge function shadow + persistance `scoring.marker_event` ; classificateur LLM sémantique (registre fermé, C01/C05/S03/S06/S07/S08/E01–E04 ; double validation S07/K06) ; comparaison legacy↔V6 sur données réelles ; généralisation M2 + réconciliation sources supprimées ; RPC `account_brain` ; 5 blocs UI + Météo UI + phrase du jour + feedback ; tests d'intégration end-to-end ; déploiement du fix score-batch derrière flag ; nettoyage code mort.

## Mise à jour — session 2b (pipeline relationnel RÉEL en shadow + 1re comparaison)

Le pipeline est désormais **vivant sur données réelles** (plus seulement des fixtures) :
- Migration `marker_event_dedup_and_candidate` : `scoring.marker_event` + `dedup_key` (unique, idempotent) + `is_candidate` (les candidats ne sont **jamais** scorés).
- **Wiring détecteurs → `scoring.marker_event`** (S04, R01, R02, A01, A02 ; E05 exclu) exécuté sur 3 dyades témoins réelles (1048 messages) → dry-run → **7 marker_events** persistés (S04/A01/A02 ; R01/R02 = 0 car données antérieures à mai 2026, baseline récente vide — honnête), tous avec `evidence_ref`+`observed_at`+`measure`. **Rejeu = 0 nouveau** (idempotence prouvée).
- **1re comparaison Legacy ↔ V6** (source→détecteur→marker_event→score V6→snapshot) : legacy **absent** (`cognitive_profiles` vide) vs V6 **partiel** (44/53/49), C/E/R = base 50 faute de marqueurs, reliability 0.06–0.24, **verdict_allowed=false** (P7). Divergence documentée, **jamais réconciliée artificiellement**.

→ §5 (détecteurs) et §9 (shadow) ci-dessous sont donc **partiellement done** : le déterministe est branché et vivant ; restent le classificateur LLM sémantique et la couverture élargie.

---

## Légende de statut
`done` implémenté + testé · `shadow` en base shadow, non branché UI · `ready` code/design prêt, non déployé (prudence) · `not_implemented_data_unavailable` bloqué faute de données réelles · `not_implemented_scope` reste à construire (front/volume), non hallucané.

---

## 1. Architecture finale (deux pipelines indépendants)
```
RELATIONNEL : sources → (P1–P7) → détecteurs → scoring.marker_event
              → calculateDyadScoreCore / calculateAccountWeatherCore (PUR)
              → build*Snapshot (fiabilité/P5/P7/statut) → scoring.score_snapshot
MÉMOIRE/ACTION : sources → account_facts (M2) → relevance (computeRelevance)
              → signaux / recommandations / stratégie
```
Les deux partagent les preuves, **jamais** les scores (doctrine). Météo ≠ priorité.

## 2. Migrations appliquées (cette session + antérieures)
- `account_facts_engine_m1` (M1, antérieure) — mémoire compte. **done**
- `scoring_v6_shadow_schema` — schéma isolé `scoring` (4 tables + RLS). **done**
- `scoring_v6_seed_registry_params` — seed `reg-v6.0` (34 marqueurs) + `params-v6.0-palier/spec`. **done**

## 3. Tables créées / modifiées
- `public.account_facts`, `account_fact_evidence`, `account_fact_user_state`, `account_recommendation_user_state` (M1). Colonnes additives sur `account_recommendations` (`dedup_key`, `origin_fact_id`, `priority_breakdown`, `snoozed_until`). **done**
- `scoring.marker_registry`, `scoring.scoring_params`, `scoring.marker_event`, `scoring.score_snapshot` (S3). RLS = `private.can_view_company` / `private.can_view_contact`. **done/shadow**

## 4. Fonctions ajoutées (TypeScript pur, `src/services/`)
| Fonction | Rôle | Statut |
|---|---|---|
| `scoring/calculateDyadScoreCore` | 5 axes personne, explicable | **done** (test 55) |
| `scoring/calculateAccountWeatherCore` | 6 cadrans Météo | **done** (test 33) |
| `scoring/snapshots.buildDyadScoreSnapshot` | fenêtre + P5/P7 + fiabilité + statut | **done** |
| `scoring/snapshots.buildAccountWeatherSnapshot` | fiabilité compte (min cadrans ≥15%) | **done** |
| `scoring/snapshots.{reliabilityDyad,statusFromCadence,displayRule}` | fiabilité/statut/affichage | **done** |
| `scoring/replay.{monthlySteps,replayDyadMonthly,computeDelta30}` | rejeu escalier mensuel | **done** |
| `relevance/computeRelevance` | priorité 0-100 + breakdown | **done** |
| `_shared/promote-facts` (M2) | promotion faits (aucune inférence) | **done** (témoin Limayrac) |
Registre/params : `scoring/registry-v6.ts` (source de vérité, seedée en base).

## 5. Détecteurs implémentés
**Aucun détecteur automatique n'est implémenté** — décision d'intégrité : les
construire sans les données réelles serait de l'hallucination. Le contrat
(`scoring.marker_event` : `evidence_ref`/`evidence_text`/`observed_at` NOT NULL)
garantit qu'aucun marqueur ne peut entrer sans preuve+date. Voir §6.

## 6. Marqueurs encore non détectables + raison
| Marqueur | Statut | Raison |
|---|---|---|
| K02 (créance échue) | `not_implemented_data_unavailable` | pas d'accès fiable montant/échéance/état payé/sens (pas de facturation connectée vérifiée) — **interdit** de déduire une créance d'un email vague |
| K04 (livrable contractuel en retard) | `not_implemented_data_unavailable` | nécessite prouver obligation + caractère contractuel + échéance + dépassement ; « document attendu » ≠ K04 |
| K08 (adresse morte) | `not_implemented_data_unavailable` | nécessite bounce/état de boîte, non capté aujourd'hui |
| E05 (acceptation réunions) | `not_implemented_scope` | statistique agenda faisable (données calendrier existantes) — détecteur non écrit |
| S04 (relance ≥2× sans réponse) | `not_implemented_scope` | détectable depuis les fils, nécessite regroupement « même objet » |
| C02/C03/S01/R01/R02/A01/A02 (baseline) | `not_implemented_data_unavailable` | dépendent de la **baseline dyade 6 mois** (P4) non construite ; sous 8 épisodes : interdits |
| C01/C05/S03/S06/S07/S08/E01–E04 (sémantiques) | `not_implemented_scope` | LLM classificateur (registre fermé) non branché ; S07/K06 exigent verbatim + double validation (seuils à proposer) |
| K01/K03/K05/K06/K07/K09 | `not_implemented_data_unavailable`/`scope` | mélange contractuel + sémantique, données partielles |

## 7. Tests & résultats
`npx vitest run src/services/scoring src/services/relevance` → **57/57 verts**, `tsc --noEmit` clean.
Suites : `calculateDyadScoreCore` (21), `calculateAccountWeatherCore` (12), `computeRelevance` (10), `snapshots`+`replay` (14).
Suite complète repo : 267 passés / 8 échecs **pré-existants** dans `sync-slack/index.test.ts` (sans rapport avec ce chantier, non touché).

## 8. Tests de référence 55 / 33
- `reference_person_v6` (Palier) : Confiance 82 · Satisfaction 17 · Engagement 72 · Réciprocité 38 · Ancrage 78 → **Score 55** ✅
- `reference_account_v6` (Client/Prospect) : Sat 46 · C&R 60 · Couv 23 · Équ 4 · Anc 25 · Dyn 17 → **Météo 33**, weakest = Équilibre ✅

## 9. Shadow legacy vs V6
`not_implemented_data_unavailable` — le shadow suppose des `marker_event` peuplés,
donc des détecteurs (§5/6). **Aucun faux marker_event n'a été créé pour reproduire
le legacy** (interdit). Le harnais de comparaison est prêt côté calcul (les cores
sont purs) mais ne peut tourner qu'après détecteurs. Étape `not_implemented` documentée.

## 10. Moteur de pertinence
`done` (shadow, non branché UI). `relevance_params-v1` = **provisional** (poids
.25/.20/.20/.15/.10/.10, somme 1, somme pondérée — pas de produit). `priority_breakdown`
produit et testé (priorité ≠ gravité vérifié). Contexte type de relation (§33) :
n'altère pas les poids ; ajuste la dérivation amont d'impact/objective_link/actionability
(à câbler quand les facts alimenteront les 6 dimensions). Colonne `account_recommendations.priority_breakdown` prête.

## 11. Les 5 blocs compte
`not_implemented_scope` — dépendent de `account_brain` (facts + relevance + snapshots)
peuplés à l'échelle. Design figé dans [DESIGN_MOTEUR_COMPTE.md](DESIGN_MOTEUR_COMPTE.md)
(t0 par utilisateur, `occurred_at > t0`, disclosure 4 niveaux, FAIT vs ANALYSE, ✓ global / × per-user).
Non hallucinés en UI.

## 12. UI / UX implémentée
`not_implemented_scope` — aucune bascule UI (conforme : « aucune bascule tant que
tests non verts + shadow stable »). Direction visuelle actuelle préservée. La Météo
V6 (Partie III) et la « phrase du jour » (LLM après JSON scoring) restent à câbler.

## 13. RLS / sécurité
`scoring.marker_event` / `scoring.score_snapshot` : lecture = exactement l'accès
fiche (`can_view_company` compte / `can_view_contact` dyade). `marker_registry` /
`scoring_params` : référence non sensible, lecture membre. **Écriture = service role
uniquement** (aucune policy insert/update authenticated). Advisors sécurité : aucun
nouveau lint introduit par M1/S3 (vérifié). **done**

## 14. Performance
Cores purs O(marqueurs) ; snapshots O(1) hors calcul. Aucune requête ajoutée au
page-load (shadow). RPC `account_brain` (design) à prévoir pour éviter le sur-fetch
existant. Rien de dégradé.

## 15. Feature flags
`not_implemented_scope` — table/mécanisme de flags (`scoring_v6_shadow`,
`scoring_v6_ui`, `relevance_engine_v1`, `account_brain_v2`, `account_facts_engine`)
à créer au moment de la bascule. Aujourd'hui tout le neuf est **inerte** (shadow /
non importé par l'app), donc désactivable de fait (rien branché).

## 16. Legacy encore présent
Intact et **inchangé** : `score-batch` (scoring personne+compte legacy),
`cognitive_profiles.trust_score/satisfaction_score` (LLM), priorités hétérogènes.
Aucune suppression, aucune conversion legacy→V6.

## 17. Code mort supprimé
Aucun (phase de nettoyage = §53, après stabilisation). Les ~700 lignes mortes de
`AccountDetailPage.tsx` + `V48AccountRelationView` restent **documentées** (audit)
mais **non supprimées** — grep + test de dépendances requis avant.

## 18. Limites connues
- Détecteurs & baselines (P4) non construits → pas de `marker_event` réel → pas de
  score V6 sur données réelles encore (uniquement fixtures de test).
- Shadow comparatif legacy/V6 en attente des détecteurs.
- 5 blocs UI, Météo UI, phrase du jour : non câblés.
- `score-batch` dedup (recos rejetées qui reviennent) : **fix prêt, non déployé** (§ ci-dessous).
- M2 non généralisé (dry-run org prouvé sur Limayrac ; généralisation en attente).

### Fix score-batch (ready, non déployé — prudence sur système utilisé)
La dédup actuelle ne regarde que les recos OUVERTES → une reco rejetée revient.
Correctif prêt : (a) peupler `dedup_key` (identité stable) sur les recos produites ;
(b) garde `!exists(reco terminale récente même dedup_key sans fait plus récent)` ;
(c) `dismissed` global = **rejet d'équipe explicite** (`feedback_reason='not_relevant_for_account'`),
le `×` par défaut = `account_recommendation_user_state.dismissed_at` (per-user).
Non déployé pour ne pas modifier un comportement de production sans fenêtre de test dédiée.

## 19. Paramètres provisional / blocked
- `current_reference` (règle V6 à reproduire) : tiers, répétition, décroissance,
  volontarité, axis_weights, authority, anchoring, dynamics, dial_weights **Client/Prospect**.
- `provisional` (calibration non établie — **jamais** « validé scientifiquement ») :
  dial_weights Fournisseur/Partenaire/Investisseur/Interne, ancres Dynamique, formule
  de fiabilité (`reliability_params-v1`), `relevance_params-v1`, seuil K07 <7j.
- `blocked` : décroissance temporelle (?D01), saturation d'axe (?E06), rétro-test des
  poids compte (→ Météo = lecture structurée, **pas** prédiction ; interdits UI « % churn »).

## 20. Étapes de calibration future
1. Construire P4 (baselines dyade 6 mois) → débloque les marqueurs statistiques.
2. Détecteurs Groupe 1 selon **disponibilité réelle** des données (E05/S04 d'abord ; K02/K04/K08 seulement si facturation/bounce accessibles).
3. Détecteurs sémantiques (LLM classificateur, registre fermé ; double validation S07/K06 — seuils à proposer).
4. Peupler `marker_event` en shadow → snapshots → **comparaison legacy vs V6** sur comptes réels.
5. Rétro-test des poids compte (pertes portefeuille) avant tout langage prédictif.
6. Calibrer `relevance_params-v1` (sensibilité + cas réels) avant de figer.
7. Généraliser M2, puis câbler les 5 blocs + Météo UI derrière feature flags.
8. Nettoyage code mort (grep + dépendances).

---

## Critères de fin (§56) — état
| Critère | État |
|---|---|
| Mémoire account_facts fonctionne | ✅ (témoin) · généralisation en attente |
| V6 tourne réellement (calcul) | ✅ cores + snapshots + replay testés |
| Personne marqueurs → axes → 55 | ✅ |
| Compte 6 cadrans → 33 | ✅ |
| Preuves : chaque point traçable | ✅ (breakdown + evidence NOT NULL) |
| Fiabilité : absence ≠ score | ✅ (P5 null, jamais 50 fabriqué) |
| Replay reproductible | ✅ |
| Pertinence : échelle commune | ✅ (moteur), câblage UI en attente |
| Delta « depuis dernier échange » temporel | conçu (design), UI non câblée |
| Signaux = changements | conçu (relevance/novelty), UI non câblée |
| Stratégie 1–3 actions explicables | conçu, UI non câblée |
| UI dépliants + preuves + feedback | non câblé (`not_implemented_scope`) |
| Sécurité RLS | ✅ |
| Legacy désactivable par flag | inerte aujourd'hui ; flags formels à créer |
| Suites de tests critiques vertes | ✅ scoring/relevance ; détecteurs/shadow en attente données |

**Le socle déterministe, tracé, reproductible et prudent est en place et testé.
Ce qui manque relève de données réelles (détecteurs) ou de câblage UI, et est
marqué honnêtement plutôt qu'inventé.**
