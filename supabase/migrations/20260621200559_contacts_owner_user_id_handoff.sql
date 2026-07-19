-- Propriétaire d'un contact (le membre qui le "détient"). Base de la passation + vue Mes/Équipe.
alter table public.contacts add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_contacts_owner on public.contacts(owner_user_id);

-- Backfill : à défaut de créateur tracé, on attribue au propriétaire (owner) de l'org.
update public.contacts c set owner_user_id = m.user_id
from (
  select distinct on (organization_id) organization_id, user_id
  from public.memberships
  order by organization_id, (role = 'owner') desc, created_at asc
) m
where m.organization_id = c.organization_id and c.owner_user_id is null;

-- Historique des passations (traçabilité)
create table if not exists public.contact_transfers (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  from_user_id uuid,
  to_user_id uuid,
  kept_copy boolean not null default false,
  transferred_by uuid,
  created_at timestamptz not null default now()
);
alter table public.contact_transfers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid='public.contact_transfers'::regclass and polname='contact_transfers_member') then
    create policy contact_transfers_member on public.contact_transfers for all to authenticated
      using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
  end if;
end $$;
