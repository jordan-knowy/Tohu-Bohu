-- Moteur mémoire du compte — M1 : SCHÉMA SEUL (additif, réversible).
-- Aucune lecture UI branchée, aucun producteur, aucune donnée écrite ici, rien
-- de supprimé. Voir DESIGN_MOTEUR_COMPTE.md (arbitrages tranchés 2026-09-14).
-- RLS strictement alignée sur le modèle compte existant (private.can_view_company).

-- ── 1. account_facts : mémoire métier du compte ─────────────────────────────
create table if not exists public.account_facts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,

  fact_type text not null check (fact_type in (
    'objective','event','decision','commitment','open_topic','blocker',
    'objection','risk','opportunity','unknown','contradiction',
    'deadline','milestone','role'
  )),

  title   text not null,
  detail  text,
  impact  text check (impact in ('friction','reinforce','milestone','neutral')),

  -- Lifecycle MÉTIER (jamais l'interaction utilisateur, cf. account_fact_user_state)
  status  text not null default 'active'
          check (status in ('active','resolved','obsolete','superseded')),
  superseded_by uuid references public.account_facts(id) on delete set null,

  -- Résolution SUGGÉRÉE (V1) : stockée, jamais appliquée automatiquement.
  resolution_suggested    boolean not null default false,
  resolution_suggested_at timestamptz,
  resolution_confidence   numeric check (resolution_confidence between 0 and 100),

  -- Temporalité : détection ≠ réalité. Le delta se base sur occurred_at.
  occurred_at    timestamptz,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  obsolete_at    timestamptz,

  -- Acteurs
  subject_contact_id uuid references public.contacts(id) on delete set null,
  owner_contact_id   uuid references public.contacts(id) on delete set null,
  owner_user_id      uuid references auth.users(id) on delete set null,
  actor_role         text,

  -- Échéance : fenêtre réelle, jamais de précision fabriquée.
  due_text_original text,
  due_at            timestamptz,          -- point exact seulement si la source en donne un
  due_window_start  timestamptz,
  due_window_end    timestamptz,          -- base du calcul « en retard »
  due_at_precision  text check (due_at_precision in ('exact','day','week','month','quarter','unknown')),
  due_is_inferred   boolean not null default false,
  due_confidence    numeric check (due_confidence between 0 and 100),

  -- Objectif (fact_type='objective') : versionné, jamais imposé.
  objective_source       text check (objective_source in ('user','crm','inferred')),
  objective_confirmed_by uuid references auth.users(id) on delete set null,

  -- Fiabilité (FAIT vs ANALYSE)
  confidence      numeric check (confidence between 0 and 100),
  inference_level text not null default 'inferred'
                  check (inference_level in ('fact','strong_inference','inferred')),

  -- Anti-doublon + traçabilité producteur
  dedup_key   text not null,
  producer    text not null,
  source_ref  jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (organization_id, company_id, dedup_key)
);

create index if not exists account_facts_company_idx      on public.account_facts(company_id, status);
create index if not exists account_facts_company_occurred on public.account_facts(company_id, occurred_at desc);
create index if not exists account_facts_company_type     on public.account_facts(company_id, fact_type, status);
create index if not exists account_facts_due              on public.account_facts(company_id, due_window_end)
  where status = 'active' and due_window_end is not null;

alter table public.account_facts enable row level security;
drop policy if exists account_facts_select_can_view on public.account_facts;
create policy account_facts_select_can_view on public.account_facts
  for select to authenticated
  using (private.can_view_company(organization_id, company_id));

-- ── 2. account_fact_evidence : 1 fait → N preuves ───────────────────────────
create table if not exists public.account_fact_evidence (
  id               uuid primary key default gen_random_uuid(),
  fact_id          uuid not null references public.account_facts(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,

  source_type  text not null check (source_type in
               ('email','meeting','transcript','document','crm','external','note','signal')),
  source_id    text,
  source_url   text,
  source_label text,

  occurred_at  timestamptz,
  excerpt      text,
  contact_id   uuid references public.contacts(id) on delete set null,
  confidence   numeric check (confidence between 0 and 100),

  created_at   timestamptz not null default now(),
  unique (fact_id, source_type, source_id)
);

create index if not exists account_fact_evidence_fact_idx
  on public.account_fact_evidence(fact_id, occurred_at desc);

alter table public.account_fact_evidence enable row level security;
drop policy if exists account_fact_evidence_select_can_view on public.account_fact_evidence;
create policy account_fact_evidence_select_can_view on public.account_fact_evidence
  for select to authenticated
  using (private.can_view_company(organization_id, company_id));

-- ── 3. account_fact_user_state : interaction PAR utilisateur ─────────────────
create table if not exists public.account_fact_user_state (
  fact_id          uuid not null references public.account_facts(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  seen_at          timestamptz,
  acknowledged_at  timestamptz,
  ignored_at       timestamptz,
  ignore_reason    text check (ignore_reason in ('not_relevant','already_handled','wrong','do_not_remind')),
  updated_at       timestamptz not null default now(),
  primary key (fact_id, user_id)
);

alter table public.account_fact_user_state enable row level security;
drop policy if exists account_fact_user_state_rw on public.account_fact_user_state;
create policy account_fact_user_state_rw on public.account_fact_user_state
  for all to authenticated
  using (user_id = auth.uid() and private.can_view_company(organization_id, company_id))
  with check (user_id = auth.uid() and private.can_view_company(organization_id, company_id));

-- ── 4. account_recommendation_user_state : feedback hybride (part per-user) ──
create table if not exists public.account_recommendation_user_state (
  recommendation_id uuid not null references public.account_recommendations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  seen_at           timestamptz,
  acknowledged_at   timestamptz,
  dismissed_at      timestamptz,
  dismiss_reason    text check (dismiss_reason in ('not_relevant','already_handled','wrong','do_not_remind')),
  updated_at        timestamptz not null default now(),
  primary key (recommendation_id, user_id)
);

alter table public.account_recommendation_user_state enable row level security;
drop policy if exists account_recommendation_user_state_rw on public.account_recommendation_user_state;
create policy account_recommendation_user_state_rw on public.account_recommendation_user_state
  for all to authenticated
  using (user_id = auth.uid() and private.can_view_company(organization_id, company_id))
  with check (user_id = auth.uid() and private.can_view_company(organization_id, company_id));

-- ── 5. account_recommendations : colonnes additives (identité stable + trace) ─
alter table public.account_recommendations
  add column if not exists dedup_key          text,
  add column if not exists origin_fact_id     uuid references public.account_facts(id) on delete set null,
  add column if not exists priority_breakdown jsonb,
  add column if not exists snoozed_until      timestamptz;

-- Au plus une reco vivante par identité stable (NULL dedup_key restent distincts,
-- donc l'existant n'est pas contraint tant que dedup_key n'est pas peuplé).
create unique index if not exists account_recommendations_dedup_open
  on public.account_recommendations(organization_id, company_id, dedup_key)
  where status in ('open','postponed');

-- ── 6. Vue calculée : « en retard » jamais stocké ───────────────────────────
-- security_invoker=true IMPÉRATIF : sans lui, la vue s'exécuterait avec les
-- droits du propriétaire et court-circuiterait la RLS de account_facts.
create or replace view public.account_facts_live
with (security_invoker = true) as
select f.*,
  (f.status = 'active'
     and coalesce(f.due_window_end,
                  case when f.due_at_precision in ('exact','day') then f.due_at end) < now()
     and f.due_at_precision is distinct from 'unknown') as is_overdue,
  (select count(*) from public.account_fact_evidence e where e.fact_id = f.id) as evidence_count,
  exists (select 1 from public.account_fact_evidence e where e.fact_id = f.id and e.excerpt is not null) as has_verbatim
from public.account_facts f;

notify pgrst, 'reload schema';
