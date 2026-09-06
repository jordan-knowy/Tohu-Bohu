-- « Porté par » sur une action de Stratégie de compte : peut être un membre
-- interne (assigned_to, déjà existant, référence profiles) OU un interlocuteur
-- côté client (nouveau assigned_contact_id, référence contacts). Un seul des
-- deux est renseigné à la fois — la fiche front s'en charge, jamais forcé ici.
alter table public.account_recommendations
  add column if not exists assigned_contact_id uuid references public.contacts(id) on delete set null;

create index if not exists account_recommendations_assigned_contact_id_idx
  on public.account_recommendations (assigned_contact_id)
  where assigned_contact_id is not null;
