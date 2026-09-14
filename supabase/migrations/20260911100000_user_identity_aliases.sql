-- Identités email supplémentaires explicitement rattachées à un même
-- utilisateur (alias Send-As, boîte pro secondaire, etc.) : le pipeline
-- comportemental self (sync-email-analysis) les traite comme « moi » au même
-- titre que l'adresse du connecteur, pour consolider un seul profil
-- comportemental au lieu d'en fragmenter un par adresse. Miroir de
-- contact_identity_aliases (20260716114940_entity_identity_resolution.sql),
-- côté utilisateur plutôt que côté contact.
create table if not exists public.user_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
create index if not exists user_identity_aliases_user_idx on public.user_identity_aliases(user_id);

alter table public.user_identity_aliases enable row level security;

drop policy if exists user_identity_aliases_select_self on public.user_identity_aliases;
create policy user_identity_aliases_select_self on public.user_identity_aliases for select to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists user_identity_aliases_insert_self on public.user_identity_aliases;
create policy user_identity_aliases_insert_self on public.user_identity_aliases for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists user_identity_aliases_delete_self on public.user_identity_aliases;
create policy user_identity_aliases_delete_self on public.user_identity_aliases for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on public.user_identity_aliases from anon;
grant select, insert, delete on public.user_identity_aliases to authenticated;
grant all on public.user_identity_aliases to service_role;

comment on table public.user_identity_aliases is 'Adresses email supplementaires (alias, Send-As, boite pro secondaire) explicitement rattachees a un meme utilisateur Tohu : consolident un seul profil comportemental self au lieu d''en fragmenter plusieurs par adresse.';

notify pgrst, 'reload schema';
