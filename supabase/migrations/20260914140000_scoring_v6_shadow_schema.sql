-- Scoring V6 — S3 : infrastructure SHADOW (schéma isolé `scoring`).
-- Additif et réversible (drop schema scoring cascade). Aucune table publique touchée,
-- aucun score legacy modifié. RLS strictement alignée sur l'accès aux fiches
-- (private.can_view_company / private.can_view_contact). Écriture = service role uniquement.

create schema if not exists scoring;
grant usage on schema scoring to authenticated, service_role;

-- 1. Registre versionné des marqueurs (référence, non sensible)
create table if not exists scoring.marker_registry (
  registry_version text not null,
  marker_id     text not null,
  scope         text not null check (scope in ('person','account','out_of_score')),
  axis_or_dial  text,
  tier          text not null check (tier in ('faible','moyen','important','critique','neutre')),
  pts_spec      integer,
  sign          smallint not null check (sign in (-1,0,1)),
  vol_base      numeric not null,
  manipulable   text not null check (manipulable in ('non','oui','difficile')),
  cost          text not null,
  detection_rule text,
  deprecated_at timestamptz,
  created_at    timestamptz not null default now(),
  primary key (registry_version, marker_id)
);

-- 2. Paramètres versionnés IMMUABLES (une version publiée n'est jamais modifiée)
create table if not exists scoring.scoring_params (
  params_version text primary key,
  mode          text not null check (mode in ('palier','spec')),
  tiers         jsonb not null,
  repetition    jsonb not null,
  decay         jsonb not null,
  axis_weights  jsonb not null,
  dial_weights  jsonb not null,
  authority     jsonb not null,
  anchoring     jsonb not null,
  dynamics      jsonb not null,
  thresholds    jsonb not null,
  implementation_status text not null,   -- 'current_reference' | 'proposed'
  calibration_status    text not null,   -- 'provisional' | 'tested' | 'blocked' (jamais 'scientifically_validated')
  published_at  timestamptz not null default now()
);

-- 3. Occurrences observées — preuve + date OBLIGATOIRES (anti-hallucination)
create table if not exists scoring.marker_event (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registry_version text not null,
  marker_id     text not null,
  scope         text not null check (scope in ('person','account')),
  dyad_id       uuid,
  contact_id    uuid references public.contacts(id) on delete set null,
  collaborator_user_id uuid references auth.users(id) on delete set null,
  account_id    uuid references public.companies(id) on delete cascade,
  observed_at   timestamptz not null,
  resolved_at   timestamptz,
  sense         smallint not null check (sense in (-1,1)),
  measure       jsonb,
  source        text not null,
  evidence_ref  text not null,
  evidence_text text not null,
  detector_version text not null,
  deprecated_at timestamptz,
  created_at    timestamptz not null default now(),
  check ((scope='person' and contact_id is not null) or (scope='account' and account_id is not null))
);
create index if not exists marker_event_account_idx on scoring.marker_event(account_id, observed_at);
create index if not exists marker_event_contact_idx on scoring.marker_event(contact_id, observed_at);

-- 4. Snapshots reproductibles (versionnés)
create table if not exists scoring.score_snapshot (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type   text not null check (entity_type in ('dyad','account')),
  entity_id     uuid not null,
  account_id    uuid references public.companies(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  at            timestamptz not null,
  snapshot_month date,
  params_version text not null,
  registry_version text not null,
  extraction_window jsonb,
  axes_or_dials jsonb not null,
  score         numeric,
  reliability   numeric,
  verdict_allowed boolean not null default false,
  status        text,
  weakest_dial  text,
  delta_30d     numeric,
  percentile    jsonb,
  created_at    timestamptz not null default now(),
  unique (entity_type, entity_id, snapshot_month, params_version, registry_version)
);
create index if not exists score_snapshot_account_idx on scoring.score_snapshot(account_id, snapshot_month);
create index if not exists score_snapshot_contact_idx on scoring.score_snapshot(contact_id, snapshot_month);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table scoring.marker_registry enable row level security;
alter table scoring.scoring_params  enable row level security;
alter table scoring.marker_event    enable row level security;
alter table scoring.score_snapshot  enable row level security;

-- Registre/paramètres = référence non sensible : lecture pour tout membre authentifié.
drop policy if exists marker_registry_read on scoring.marker_registry;
create policy marker_registry_read on scoring.marker_registry for select to authenticated using (true);
drop policy if exists scoring_params_read on scoring.scoring_params;
create policy scoring_params_read on scoring.scoring_params for select to authenticated using (true);

-- Events/snapshots : STRICTEMENT le même accès que les fiches (compte/contact).
drop policy if exists marker_event_select on scoring.marker_event;
create policy marker_event_select on scoring.marker_event for select to authenticated
using (
  private.is_org_member(organization_id) and (
    (scope = 'account' and account_id is not null and private.can_view_company(organization_id, account_id))
    or (scope = 'person' and contact_id is not null and private.can_view_contact(organization_id, contact_id))
  )
);
drop policy if exists score_snapshot_select on scoring.score_snapshot;
create policy score_snapshot_select on scoring.score_snapshot for select to authenticated
using (
  private.is_org_member(organization_id) and (
    (entity_type = 'account' and account_id is not null and private.can_view_company(organization_id, account_id))
    or (entity_type = 'dyad' and contact_id is not null and private.can_view_contact(organization_id, contact_id))
  )
);
-- Aucune policy insert/update/delete pour authenticated → écriture réservée au
-- service role (edge functions), qui contourne la RLS.

grant select on all tables in schema scoring to authenticated;
grant all on all tables in schema scoring to service_role;

notify pgrst, 'reload schema';
