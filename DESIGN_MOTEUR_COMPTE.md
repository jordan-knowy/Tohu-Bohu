# Design — Moteur mémoire du compte (spéc. avant migration)

> **Aucune migration lancée.** Document de conception à valider.
> Complète [AUDIT_MOTEUR_COMPTE.md](AUDIT_MOTEUR_COMPTE.md). Répond à A–F.
> Contraintes verrouillées : séparation fait/preuve/reco/action-utilisateur ;
> lifecycle métier ≠ statut utilisateur ; multi-utilisateurs ; delta sur date
> réelle ; échéance imprécise/inférée ; ranking 0–100 explicable ; objectif
> versionné ; migration additive réversible ; RLS identique à l'existant.

---

## Principes de séparation (les 4 objets ne se mélangent jamais)

| Objet | Table | Rôle | Portée |
|---|---|---|---|
| **Fait** | `account_facts` | mémoire métier : ce qui est/s'est produit | workspace (partagé) |
| **Preuve** | `account_fact_evidence` | 1..N sources qui étayent un fait | workspace |
| **Interaction utilisateur** | `account_fact_user_state` | vu / pris en compte / ignoré, **par utilisateur** | par utilisateur |
| **Recommandation** | `account_recommendations` *(existe déjà, complète)* | action dérivée du moteur + feedback ✓/× | workspace |

- Le **lifecycle métier** d'un fait (`active/resolved/obsolete/superseded`) décrit la réalité, il est **commun**.
- L'**interaction** (`seen/acknowledged/ignored`) est **par utilisateur** : deux commerciaux qui suivent le même compte ont chacun leur « vu ».
- Une **recommandation n'est pas un fait**. Elle *pointe* vers le(s) fait(s) qui la motive(nt) (`origin_fact_id`) mais vit dans `account_recommendations`, avec identité stable et feedback persistant.

---

## A. DDL complet proposé

### A.1 `account_facts` — mémoire métier

```sql
create table public.account_facts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,

  -- Type métier (taxonomie fermée, contrôlée)
  fact_type text not null check (fact_type in (
    'objective','event','decision','commitment','open_topic','blocker',
    'objection','risk','opportunity','unknown','contradiction',
    'deadline','milestone','role'
  )),

  title   text not null,
  detail  text,

  -- Impact relationnel (aligné sur person_key_moments)
  impact  text check (impact in ('friction','reinforce','milestone','neutral')),

  -- ── LIFECYCLE MÉTIER (jamais l'interaction utilisateur) ──
  status  text not null default 'active'
          check (status in ('active','resolved','obsolete','superseded')),
  superseded_by uuid references public.account_facts(id) on delete set null,

  -- Résolution SUGGÉRÉE (V1) : le moteur peut penser qu'un engagement est tenu,
  -- mais NE bascule PAS status='resolved' tout seul. La suggestion est stockée,
  -- la résolution réelle reste une action humaine (ou une auto-résolution
  -- déterministe ajoutée plus tard). status ne devient 'resolved' que sur
  -- confirmation ; ces 3 colonnes n'affectent jamais le lifecycle réel.
  resolution_suggested   boolean not null default false,
  resolution_suggested_at timestamptz,
  resolution_confidence  numeric check (resolution_confidence between 0 and 100),

  -- ── TEMPORALITÉ (détection ≠ réalité) ──
  occurred_at    timestamptz,           -- date RÉELLE de l'événement  → base du delta
  first_seen_at  timestamptz not null default now(),  -- 1re détection Tohu
  last_seen_at   timestamptz not null default now(),  -- dernière reconfirmation
  resolved_at    timestamptz,
  obsolete_at    timestamptz,

  -- ── ACTEURS ──
  subject_contact_id uuid references public.contacts(id) on delete set null, -- de qui/à propos de qui
  owner_contact_id   uuid references public.contacts(id) on delete set null, -- côté client qui porte
  owner_user_id      uuid references auth.users(id) on delete set null,      -- interne qui porte
  actor_role         text,              -- rôle joué (décideur, sponsor, bloqueur…)

  -- ── ÉCHÉANCE : structurée SANS jamais fabriquer de la précision ──
  -- Une échéance floue garde sa granularité réelle : on stocke la FENÊTRE, pas
  -- un point inventé. « d'ici la semaine prochaine » → window_start/end = cette
  -- semaine, precision='week', is_inferred=true, due_at reste NULL (aucun point
  -- exact n'existe). due_at n'est renseigné que pour precision exact/day.
  due_text_original text,               -- verbatim de l'échéance (« d'ici vendredi »)
  due_at            timestamptz,         -- point exact SEULEMENT si la source en donne un
  due_window_start  timestamptz,         -- début de la fenêtre possible
  due_window_end    timestamptz,         -- fin de la fenêtre possible → base du « en retard »
  due_at_precision  text check (due_at_precision in
                    ('exact','day','week','month','quarter','unknown')),
  due_is_inferred   boolean not null default false,
  due_confidence    numeric check (due_confidence between 0 and 100),
  -- Parsing déterministe d'abord ; LLM en fallback quand le déterministe échoue,
  -- SANS jamais rendre la date plus précise que due_text_original.
  -- « en retard » n'est JAMAIS stocké : calculé sur due_window_end (voir vue).

  -- ── OBJECTIF (fact_type='objective') : versionné, jamais imposé ──
  objective_source  text check (objective_source in ('user','crm','inferred')),
  objective_confirmed_by uuid references auth.users(id) on delete set null,

  -- ── FIABILITÉ (FAIT vs ANALYSE) ──
  confidence      numeric check (confidence between 0 and 100),
  inference_level text not null default 'inferred'
                  check (inference_level in ('fact','strong_inference','inferred')),
  -- 'fact' = observable (une preuve verbatim existe) ; sinon = déduction Tohu.

  -- ── ANTI-DOUBLON + traçabilité producteur ──
  dedup_key   text not null,            -- stable : même fait → même clé
  producer    text not null,            -- 'promote_moments'|'promote_commitments'|'score_batch'|'signals'|'user'|'llm'
  source_ref  jsonb,                    -- pointeur brut (contact_id source, signal_id…)

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (organization_id, company_id, dedup_key)
);

create index account_facts_company_idx      on public.account_facts(company_id, status);
create index account_facts_company_occurred on public.account_facts(company_id, occurred_at desc);
create index account_facts_company_type      on public.account_facts(company_id, fact_type, status);
create index account_facts_due               on public.account_facts(company_id, due_at)
       where status = 'active' and due_at is not null;

alter table public.account_facts enable row level security;

-- RLS : STRICTEMENT identique au modèle compte existant (can_view_company).
create policy account_facts_select_can_view on public.account_facts
  for select to authenticated
  using (private.can_view_company(organization_id, company_id));
-- Écriture métier = service role (edge functions) uniquement → pas de policy
-- insert/update/delete pour authenticated. Les seules écritures utilisateur
-- (objectif confirmé, résolution manuelle) passent par des RPC SECURITY DEFINER
-- qui revérifient can_view_company (voir §A.5).
```

### A.2 `account_fact_evidence` — 1 fait → N preuves

```sql
create table public.account_fact_evidence (
  id               uuid primary key default gen_random_uuid(),
  fact_id          uuid not null references public.account_facts(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,  -- redondant → RLS directe + perf

  source_type  text not null check (source_type in
               ('email','meeting','transcript','document','crm','external','note','signal')),
  source_id    text,               -- id métier (meeting.id, signal.id, message.id…) — text car hétérogène
  source_url   text,
  source_label text,

  occurred_at  timestamptz,        -- date réelle de CETTE preuve (mail du 8/09…)
  excerpt      text,               -- verbatim (rend le fait 'fact' plutôt qu'analyse)
  contact_id   uuid references public.contacts(id) on delete set null, -- personne concernée
  confidence   numeric check (confidence between 0 and 100),

  created_at   timestamptz not null default now(),
  unique (fact_id, source_type, source_id)   -- une source ne s'attache qu'une fois
);

create index account_fact_evidence_fact_idx on public.account_fact_evidence(fact_id, occurred_at desc);

alter table public.account_fact_evidence enable row level security;
create policy account_fact_evidence_select_can_view on public.account_fact_evidence
  for select to authenticated
  using (private.can_view_company(organization_id, company_id));
```

> Règle : un fait a `inference_level='fact'` **si et seulement si** au moins une preuve porte un `excerpt` non nul (observable). Sinon c'est une analyse.

### A.3 `account_fact_user_state` — interaction par utilisateur

```sql
create table public.account_fact_user_state (
  fact_id          uuid not null references public.account_facts(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,

  seen_at          timestamptz,
  acknowledged_at  timestamptz,       -- « pris en compte »
  ignored_at       timestamptz,       -- « ne plus me montrer »
  ignore_reason    text check (ignore_reason in
                   ('not_relevant','already_handled','wrong','do_not_remind')),

  updated_at       timestamptz not null default now(),
  primary key (fact_id, user_id)
);

alter table public.account_fact_user_state enable row level security;
-- Chaque utilisateur ne lit/écrit QUE son propre état, et seulement s'il voit le compte.
create policy account_fact_user_state_rw on public.account_fact_user_state
  for all to authenticated
  using (user_id = auth.uid() and private.can_view_company(organization_id, company_id))
  with check (user_id = auth.uid() and private.can_view_company(organization_id, company_id));
```

### A.4 `account_recommendations` — **on réutilise l'existant** (déjà complet)

La table a déjà : `contact_id, source_signal_id, category, priority, title, justification, recommended_action, impact_type, source_label/url, observed_at, confidence, inference_level, status(open/completed/dismissed/postponed), assigned_to, assigned_contact_id, due_at, completed_at, dismissed_at, feedback_type, feedback_reason, updated_by`.

**Ajouts additifs minimes** (une migration ALTER, sans rien casser) :

```sql
alter table public.account_recommendations
  add column if not exists dedup_key      text,        -- identité STABLE (indépendante du texte)
  add column if not exists origin_fact_id uuid references public.account_facts(id) on delete set null,
  add column if not exists priority_breakdown jsonb,    -- explication du score (voir C)
  add column if not exists snoozed_until  timestamptz;  -- 'postponed' daté

create unique index if not exists account_recommendations_dedup_open
  on public.account_recommendations(organization_id, company_id, dedup_key)
  where status in ('open','postponed');   -- au plus 1 reco vivante par identité
```

`feedback_type`/`feedback_reason` existent déjà → le rejet **global** avec raison est déjà stockable. La correction porte sur la **logique** (voir F : dédup qui respecte les états terminaux).

**Feedback hybride (ajustement M1)** — l'état *réel* de la reco est global au compte ; l'interaction *individuelle* est par utilisateur. Un `×` d'une personne ne doit PAS supprimer la reco pour l'équipe :

- **Global** (`account_recommendations.status`) : `completed` / `resolved` / `obsolete`, **et** un rejet d'équipe explicite `status='dismissed'` + `feedback_reason='not_relevant_for_account'` — réservé à l'action ncommée « Non pertinent pour ce compte ».
- **Par utilisateur** (`account_recommendation_user_state`, ci-dessous) : `seen` / `acknowledged` / `dismissed` (= « masquer pour moi »). Un `×` par défaut agit **ici**, pas sur le statut global.

```sql
create table public.account_recommendation_user_state (
  recommendation_id uuid not null references public.account_recommendations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  seen_at           timestamptz,
  acknowledged_at   timestamptz,
  dismissed_at      timestamptz,          -- « masquer pour moi » (n'affecte pas l'équipe)
  dismiss_reason    text check (dismiss_reason in
                    ('not_relevant','already_handled','wrong','do_not_remind')),
  updated_at        timestamptz not null default now(),
  primary key (recommendation_id, user_id)
);
alter table public.account_recommendation_user_state enable row level security;
create policy account_recommendation_user_state_rw on public.account_recommendation_user_state
  for all to authenticated
  using (user_id = auth.uid() and private.can_view_company(organization_id, company_id))
  with check (user_id = auth.uid() and private.can_view_company(organization_id, company_id));
```

Lecture « Stratégie de compte » : reco visible si `status in (open,postponed)` **ET** pas `dismissed_at` par le viewer courant. Le retour d'une reco après un `×` individuel est ainsi impossible (masquage per-user), sans priver l'équipe.

### A.5 RPC utilisateur (écritures autorisées, SECURITY DEFINER)

```
account_fact_mark(p_fact_id, p_action in ('seen','acknowledged','ignored'), p_reason?)   -- upsert user_state
account_set_objective(p_company_id, p_title, p_detail?)  -- crée fact objective source='user', supersede l'ancien
account_confirm_inferred_objective(p_fact_id)            -- inferred → confirmed (objective_source reste, confirmed_by=uid)
account_resolve_fact(p_fact_id)                           -- résolution manuelle (engagement tenu, sujet clos)
```
Chacune revérifie `private.can_view_company(org, company)` avant écriture. Aucune écriture directe `authenticated` sur `account_facts`.

---

## B. Cycle de vie concret (email → … → ✓ → résolution)

```
J-14  Email entrant : « Envoyez-nous le dossier technique, on tranche au CODIR du 18. »
      └─ sync-email-analysis (LLM, déjà en place) extrait :
         • commitment { text:"envoyer dossier technique", owner:'user',
                        due_date:"2026-09-18", source_quote:"...", source_direction:'inbound' }
         • moment { title:"Dossier technique demandé", impact:'friction' }

J-14  promote-facts (déterministe) crée/agrège dans account_facts :
      FACT #1  type=commitment  title="Envoyer le dossier technique"
               occurred_at=J-14  due_at=2026-09-18T00:00 due_at_precision='day'
               due_is_inferred=false  owner_user_id=<moi>  status=active
               inference_level='fact'  dedup_key=hash(company|commitment|"dossier technique")
      EVIDENCE → source_type='email' occurred_at=J-14 excerpt="Envoyez-nous le dossier…"

      FACT #2  type=open_topic  title="Décision CODIR attendue le 18/09"
               occurred_at=J-14  due_at=2026-09-18  status=active

J-1   Aucune preuve d'envoi détectée. Vue account_facts_live calcule :
      FACT #1 → is_overdue = (due_at < now AND status=active AND precision<>'unknown') = **true**
      → « Signaux récents » fait remonter FACT #1 (urgence haute, actionnable).
      → Le moteur de recos crée (ou met à jour) RECO :
         account_recommendations { dedup_key=hash(company|"send_doc"|fact#1),
           origin_fact_id=FACT#1, category='engagement', title="Envoyer le dossier avant le CODIR",
           priority=<ranking 0-100>, status='open' }   ← reco ≠ fait, identité stable

J     Utilisateur clique ✓ Fait sur la reco :
      account_recommendations.status='completed', completed_at=now, feedback_type='done'
      → la reco NE réapparaît pas (unique index sur open/postponed + garde état terminal).

J+1   Email sortant détecté : « Voici le dossier technique. »
      └─ nouvelle EVIDENCE sur FACT #1 (source='email', excerpt=…)
      └─ account_resolve_fact(FACT#1) déclenché par la détection d'exécution :
         FACT #1 status='resolved', resolved_at=now
      → sort de « Signaux récents » et de « Depuis dernier échange » (plus active)
      → RESTE dans « Historique & mémoire » comme jalon (status=resolved, impact reinforce).

J+3   CODIR : décision positive détectée →
      FACT #3 type=decision title="Le CODIR valide le principe" impact=reinforce
      FACT #2 (open_topic décision attendue) → status='resolved' (superseded par la décision).
```

Point clé : **le même FACT #1** est lu différemment selon le bloc (delta / signal / stratégie via sa reco / historique), **sans jamais dupliquer le texte** — chaque bloc applique son filtre sur la même ligne.

---

## C. Ranking 0–100 — pseudo-code exact

Objectif : `prio 88` et `prio 92` comparables **quelle que soit la catégorie**. Somme **pondérée et normalisée** (pas de produit naïf où un facteur nul annule tout). Chaque sous-score ∈ [0,1], poids = 1 au total, résultat ×100. Le détail est **stocké** (`priority_breakdown`) pour expliquer « pourquoi 92 ».

```ts
// src/services/account-ranking.ts  (pur, testable, partagé front/back via copie deno)

type RelationType = 'prospect' | 'client' | 'partenaire' | 'fournisseur' | 'autre'

interface FactForRanking {
  factType: string
  impact: 'friction' | 'reinforce' | 'milestone' | 'neutral' | null
  occurredAt: Date | null
  firstSeenAt: Date
  dueAt: Date | null
  dueIsInferred: boolean
  confidence: number | null        // 0-100
  inferenceLevel: 'fact' | 'strong_inference' | 'inferred'
  linkedToObjective: boolean       // ce fait touche-t-il l'objectif courant ?
  isActionable: boolean            // existe-t-il une action nette possible ?
}

// ── 6 sous-scores, chacun borné [0,1] ──
function fImpact(f): number {
  // friction/risque pèsent plus qu'un milestone neutre
  const base = { friction: 1, reinforce: 0.6, milestone: 0.4, neutral: 0.2 }[f.impact ?? 'neutral']
  const typeBoost = { risk:1, blocker:1, objection:0.9, opportunity:0.8, commitment:0.7,
                      contradiction:0.9, decision:0.6, open_topic:0.5 }[f.factType] ?? 0.4
  return clamp01(0.6 * base + 0.4 * typeBoost)
}
function fUrgency(f, now): number {
  // Réfère à la FIN de fenêtre (dueWindowEnd), sinon au point exact, jamais à
  // une précision fabriquée. Pas d'échéance → léger biais deadline.
  const ref = f.dueWindowEnd ?? (f.dueAtPrecision === 'exact' || f.dueAtPrecision === 'day' ? f.dueAt : null)
  if (!ref) return f.factType === 'deadline' ? 0.5 : 0.3
  const days = (ref - now) / DAY
  let u = days <= 0 ? 1                    // fenêtre passée = en retard = max
        : days <= 2 ? 0.9
        : days <= 7 ? 0.7
        : days <= 30 ? 0.4 : 0.2
  if (f.dueIsInferred) u *= 0.7            // échéance floue → urgence atténuée
  return clamp01(u)
}
function fNovelty(f, now): number {
  // basé sur occurred_at (réel) en priorité, first_seen_at en repli
  const ref = f.occurredAt ?? f.firstSeenAt
  const days = (now - ref) / DAY
  return clamp01(days <= 3 ? 1 : days <= 7 ? 0.8 : days <= 30 ? 0.5 : days <= 90 ? 0.3 : 0.15)
}
function fReliability(f): number {
  const c = (f.confidence ?? 50) / 100
  const lvl = { fact: 1, strong_inference: 0.8, inferred: 0.6 }[f.inferenceLevel]
  return clamp01(0.5 * c + 0.5 * lvl)     // plancher : jamais 0 (évite l'annulation)
}
function fActionability(f): number { return f.isActionable ? 1 : 0.4 }
function fObjective(f): number { return f.linkedToObjective ? 1 : 0.45 }

// ── Poids de base (somme = 1) ──
const BASE_W = {
  impact: 0.24, urgency: 0.20, novelty: 0.16,
  reliability: 0.14, actionability: 0.14, objective: 0.12,
}

// ── Modulation par type de relation (re-normalisée pour toujours sommer à 1) ──
const RELATION_TILT: Record<RelationType, Partial<typeof BASE_W>> = {
  prospect:   { urgency: +0.04, objective: +0.04, impact: -0.04, novelty: -0.04 }, // timing/décision
  client:     { impact: +0.05, reliability: +0.03, novelty: -0.04, urgency: -0.04 }, // churn/satisfaction
  partenaire: { objective: +0.04, actionability: +0.03, urgency: -0.03, impact: -0.04 }, // engagements réciproques
  fournisseur:{ reliability: +0.04, impact: +0.02, novelty: -0.03, objective: -0.03 },
  autre:      {},
}

function weights(rel: RelationType) {
  const w = { ...BASE_W }
  for (const [k, d] of Object.entries(RELATION_TILT[rel])) w[k] += d
  const sum = Object.values(w).reduce((a, b) => a + b, 0)
  for (const k in w) w[k] /= sum          // re-normalisation → somme exacte = 1
  return w
}

function rankFact(f: FactForRanking, rel: RelationType, now = new Date()) {
  const s = {
    impact: fImpact(f), urgency: fUrgency(f, now), novelty: fNovelty(f, now),
    reliability: fReliability(f), actionability: fActionability(f), objective: fObjective(f),
  }
  const w = weights(rel)
  const score01 = Object.keys(w).reduce((acc, k) => acc + w[k] * s[k], 0)
  const priority = Math.round(clamp01(score01) * 100)   // 0–100, échelle COMMUNE
  return {
    priority,
    breakdown: Object.keys(w).map(k => ({           // stocké → « pourquoi 92 »
      factor: k, sub: round2(s[k]), weight: round2(w[k]), contribution: Math.round(w[k]*s[k]*100),
    })),
  }
}
```

Propriétés garanties :
- **Comparable inter-catégories** : tout passe par les mêmes 6 axes normalisés, jamais par un compteur brut (concentration% etc.).
- **Pas d'annulation** : `reliability`/`objective`/`actionability` ont un **plancher > 0** ; un facteur faible réduit sans écraser.
- **Explicable** : `breakdown` liste la contribution (en points) de chaque axe → l'UI affiche « Impact +22 · Urgence +18 · Nouveauté +13 … = 92 ».
- **Sensible à la relation** : les poids penchent selon Prospect/Client/Partenaire, tout en sommant toujours à 1.

---

## D. Logique des 5 blocs (même mémoire, 5 lectures)

Vue calculée partagée (jamais stockée) :

```sql
create view public.account_facts_live as
select f.*,
  -- « en retard » = toute la fenêtre possible est passée (jamais un point inventé) :
  -- on prend due_window_end, sinon due_at si précision exact/day.
  (f.status='active'
     and coalesce(f.due_window_end,
                  case when f.due_at_precision in ('exact','day') then f.due_at end) < now()
     and f.due_at_precision <> 'unknown') as is_overdue,
  (select count(*) from account_fact_evidence e where e.fact_id=f.id) as evidence_count,
  exists (select 1 from account_fact_evidence e where e.fact_id=f.id and e.excerpt is not null) as has_verbatim
from public.account_facts f;
```

RPC unique `account_brain(p_company_id, p_since timestamptz default null)` renvoie faits actifs + objectif courant + états user (pour `auth.uid()`). Chaque bloc filtre :

| Bloc | Question | Filtre / logique |
|---|---|---|
| **Ce que montrent les échanges** | Situation dominante | **Hybride** : squelette déterministe = objectif courant + phase score + faits dominants (plus haut ranking parmi risk/opportunity/blocker) ; habillage = `account_strategic_readings.synthese` (LLM borné, cache). « Pourquoi ? » déplie les faits + preuves qui l'étayent. |
| **Depuis votre dernier échange** | Qu'ai-je manqué ? | **t0 = dernière interaction à laquelle LE VIEWER a réellement participé** (max meetings/messages où `auth.uid()` est présent). Faits avec `occurred_at > t0` (date **réelle**), triés ranking, **1 en tête** + « Voir X autres ». **Si le viewer n'a aucun échange personnel** : ne PAS utiliser silencieusement celui d'un collègue → afficher « Vous n'avez pas encore échangé avec ce compte » et, séparément, « Dernier échange de l'équipe : {date} par {membre} ». Vide (t0 existe, rien après) → « Aucun changement significatif depuis votre dernier échange sur les sources connectées. » |
| **Signaux récents** | Qu'est-ce qui mérite mon attention ? | Faits `status='active'`, **non `ignored` par le viewer**, actionnables/à impact, triés par `rankFact(rel)`. Top 3–4 + « Voir X de plus ». Le nombre affiché = `priority` (0–100) avec breakdown au clic. `is_overdue` remonte en tête. |
| **Stratégie de compte** | Que dois-je faire ? | `account_recommendations` `status in (open,postponed)`, triées `priority DESC`, **1–3** affichées. Chaque reco → `origin_fact_id` pour tracer. ✓ = completed (ne revient pas), × = dismissed + `feedback_reason`. |
| **Historique & mémoire** | Comment en est-on arrivé là ? | Faits `fact_type in (milestone, decision, event, role)` **ou** `status in (resolved, obsolete)`, triés `occurred_at DESC`. Événements **structurants** uniquement (pas chaque mail). Un signal résolu **migre** ici (changement de statut, pas de copie). |

Anti-doublon : un fait = une ligne ; les blocs 2/3/5 peuvent tous référencer FACT #1, mais chacun affiche un **libellé de rôle différent** (delta / attention / jalon) calculé à partir du même objet — jamais le `title` recopié tel quel dans 4 cartes.

---

## E. Stratégie de backfill (sans perte)

Tout par `producer` traçable, **idempotent** (via `dedup_key`), rejouable.

1. **`person_key_moments` → facts** (`producer='promote_moments'`) :
   `event`/`milestone` selon impact ; `company_id` via `contacts.company_id` ; `occurred_at=moment.occurred_at` ; `subject_contact_id=contact_id` ; `confidence`, `inference_level` dérivé ; 1 evidence (`source_type` du moment, `excerpt=summary`). `dedup_key=hash(company|'moment'|normalize(title))`.
2. **`person_memory_entries[commitment]` → facts** (`producer='promote_commitments'`) :
   `fact_type='commitment'` ; **parse du `due_date` textuel** (« échéance 2026-05-01 » / « d'ici la semaine prochaine ») → `due_at` + `due_at_precision` + `due_is_inferred` ; `owner` déduit de `source_direction` ; `status='resolved'` si `resolved_at` non nul ; evidence = `source_excerpt`+`source_occurred_at`+`source_direction`.
3. **Réunions / mails** (métadonnées, corps jamais stocké) : pas de fait direct — servent d'`evidence` (rattachées aux faits ci-dessus) et au calcul de **t0**.
4. **`company_signals` (futurs)** → facts (`producer='signals'`) : `event`/`risk`/`opportunity` selon `family` ; `occurred_at=observed_at` ; `first_seen_at`/`last_seen_at` **repris tels quels** (la table les a déjà) ; evidence `source_type='signal'`. `dedup_key` réutilise `company_signals.deduplication_key`.
5. **Objectif initial** : aucun `user`/`crm` → le moteur pose un `objective` **`inferred`** par compte (déduit type+phase+dernière décision/opportunité), affiché comme hypothèse.

Backfill = fonction `backfill_account_facts(company_id?)` en **service role**, lancée par lot, journalisée. Rejouable sans doublon (upsert sur `dedup_key`).

---

## F. Plan de migration progressif + rollback

**Additif, jamais destructif. Rien n'est supprimé tant que le nouveau moteur n'est pas validé.**

| Étape | Contenu | Réversibilité |
|---|---|---|
| **M1 — Schéma** | Créer `account_facts`, `account_fact_evidence`, `account_fact_user_state`, vue `account_facts_live`, RPC ; ALTER additif sur `account_recommendations` (`dedup_key`, `origin_fact_id`…). **Aucune lecture UI branchée.** | `drop` des nouveaux objets = retour intégral. L'app ne les lit pas encore. |
| **M2 — Producteurs (shadow)** | `promote-facts` + backfill + fix dédup recos, **en écriture seule**. L'ancien système (`company_signals`, recos actuelles) **continue de tourner en parallèle**. | Désactiver le cron promote-facts ; données inertes. |
| **M3 — Comparaison** | RPC `account_brain` dispo mais lue derrière un **feature flag** (`account_engine_v2`, par workspace/user). Écran de diff interne : ancienne fiche vs nouvelle sur comptes réels. | Flag off = ancienne fiche à l'identique. |
| **M4 — Bascule lecture** | Activer le flag progressivement (staff → early → tous). Les 5 blocs lisent le moteur. Écritures ancien système **maintenues** en secours. | Flag off à tout moment → retour ancien système sans perte (les tables restent alimentées). |
| **M5 — Stabilisation** | Flag on par défaut, ancien chemin gelé (plus branché) mais **tables conservées**. | Re-brancher l'ancien chemin (code encore présent). |
| **M6 — Nettoyage (séparé, plus tard)** | Étape distincte, **après** M5 validé : retrait des ~700 lignes mortes (§6 audit) + de l'ancien chemin, **après audit des dépendances** (grep imports, tests). | Revert git ciblé. |

- **Feature flag** = table `feature_flags` ou colonne `account_settings.engine_version` — bascule par compte, rollback instantané.
- **RLS** identique (`can_view_company`) → aucun fait/preuve/reco visible hors périmètre. Vérifié par test d'isolation (utilisateur non-grant ne voit rien).
- **Suppression code mort ≠ migration métier** : jamais dans la même PR que M1.

---

## Arbitrages — TRANCHÉS (validés le 2026-09-14)

1. **Feedback recommandation : hybride.** État réel (`completed/resolved/obsolete` + rejet d'équipe explicite `not_relevant_for_account`) = global ; `seen/acknowledged/dismissed` = par utilisateur (`account_recommendation_user_state`). Un `×` individuel masque pour soi, jamais pour l'équipe.
2. **t0 = par utilisateur.** Dernière interaction où le viewer a réellement participé. Aucun échange perso → état affiché explicitement + dernier échange d'équipe montré séparément (jamais substitué en silence).
3. **Résolution d'engagement : manuel + suggestion.** Le moteur stocke `resolution_suggested/at/confidence` mais ne bascule jamais `status='resolved'` tout seul en V1. Auto-résolutions déterministes = itération ultérieure.
4. **Échéances floues : granularité préservée.** `due_text_original` + `due_window_start/end` + `due_at` (point seulement si exact/day) + `due_at_precision` + `due_is_inferred` + `due_confidence`. Déterministe d'abord, LLM en fallback, **jamais** plus précis que la source.
