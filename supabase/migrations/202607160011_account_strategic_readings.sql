-- Lecture stratégique des comptes : synthèse relationnelle générée côté
-- serveur (Edge Function account-strategic-reading) et persistée.
-- Idempotente. À appliquer sur bgmtzwfafcgjklgygvtx.

create table if not exists public.account_strategic_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- { synthese: text, forces: text[], risques: text[], prochaines_actions: text[] }
  content jsonb not null default '{}'::jsonb,
  confidence integer check (confidence between 0 and 100),
  -- { contacts, signals, interactions, messages } : matière réellement utilisée
  source_counts jsonb not null default '{}'::jsonb,
  model text,
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_id)
);

comment on table public.account_strategic_readings is
  'Synthèse relationnelle d''un compte, produite uniquement à partir des données persistées (contacts, signaux, réunions, métadonnées d''échanges). Écriture réservée à la service role.';

create index if not exists account_strategic_readings_company_idx
  on public.account_strategic_readings(company_id);

alter table public.account_strategic_readings enable row level security;

drop policy if exists account_strategic_readings_member_select on public.account_strategic_readings;
create policy account_strategic_readings_member_select on public.account_strategic_readings
for select to authenticated
using (private.is_org_member(organization_id));

revoke all on public.account_strategic_readings from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.account_strategic_readings from authenticated;
grant select on public.account_strategic_readings to authenticated;
grant all on public.account_strategic_readings to service_role;

notify pgrst, 'reload schema';
