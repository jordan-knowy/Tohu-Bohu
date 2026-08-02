-- Engagements pris : permettre de marquer « tenu » (resolved_at) ou de supprimer
-- une entrée de mémoire, par n'importe quel membre du workspace (mémoire d'équipe
-- partagée). Les engagements validés restent en mémoire relationnelle, sortis du
-- suivi actif.

alter table public.person_memory_entries
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

drop policy if exists person_memory_member_update on public.person_memory_entries;
create policy person_memory_member_update on public.person_memory_entries
  for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists person_memory_member_delete on public.person_memory_entries;
create policy person_memory_member_delete on public.person_memory_entries
  for delete to authenticated
  using (private.is_org_member(organization_id));

notify pgrst, 'reload schema';
