-- add_tracked_contact forçait watch_enabled=true à chaque intégration (insert
-- ET on conflict), alors que la colonne person_user_settings.watch_enabled
-- (migration 20260716193854) est déclarée "default false" : la veille doit
-- être une action explicite de l'utilisateur (bouton "Veille" des listes
-- Comptes/Personnes), jamais un effet de bord de l'ajout d'une personne.
create or replace function public.add_tracked_contact(
  p_organization_id uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  update public.contacts
  set
    is_tracked = true,
    tracked_at = coalesce(tracked_at, now()),
    tracked_by = auth.uid(),
    owner_user_id = coalesce(owner_user_id, auth.uid()),
    updated_at = now()
  where id = p_contact_id
    and organization_id = p_organization_id
    and merged_into_contact_id is null;

  if not found then
    raise exception 'Personne introuvable';
  end if;

  -- Ne crée la ligne que si elle n'existe pas encore (watch_enabled reste à
  -- son défaut false) ; si elle existe déjà, on ne touche plus watch_enabled
  -- du tout — un ré-ajout ne doit jamais réactiver une veille désactivée.
  insert into public.person_user_settings (
    organization_id, contact_id, user_id, updated_at
  ) values (
    p_organization_id, p_contact_id, auth.uid(), now()
  )
  on conflict (organization_id, contact_id, user_id) do nothing;
end;
$$;
