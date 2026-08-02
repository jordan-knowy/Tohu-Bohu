-- « Les moments qui comptent » : jalons datés extraits de l'analyse contextuelle
-- des échanges (emails + réunions), avec un impact relationnel typé. Alimente
-- l'historique enrichi de la fiche Personne. Écriture réservée au service role
-- (edge function d'analyse) ; lecture par les membres du workspace.

create table if not exists public.person_key_moments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  occurred_at timestamptz not null,
  title text not null,
  summary text,
  impact text not null default 'milestone' check (impact in ('friction', 'reinforce', 'milestone')),
  confidence numeric check (confidence between 0 and 100),
  source_type text not null default 'email_analysis',
  source_label text not null default 'Tohu · moment détecté',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists person_key_moments_contact_date_idx
  on public.person_key_moments(contact_id, occurred_at desc);

alter table public.person_key_moments enable row level security;

drop policy if exists person_key_moments_member_select on public.person_key_moments;
create policy person_key_moments_member_select on public.person_key_moments
  for select to authenticated using (private.is_org_member(organization_id));

notify pgrst, 'reload schema';
