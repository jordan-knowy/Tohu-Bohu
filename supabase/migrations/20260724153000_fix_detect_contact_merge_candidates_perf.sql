-- La première version de detect_contact_merge_candidates comparait toutes les
-- paires de contacts d'un org via similarity() en scalaire : sur un org réel de
-- 1715 contacts, ça balaie ~1,47M paires (5s, et 43 907 résultats à 0.3 — bien
-- trop bruyant pour être proposé à un utilisateur). Cette version pousse la
-- comparaison de noms via l'opérateur `%` (utilise l'index GIN trigram déjà
-- créé) avec un seuil resserré à 0.6 via set_limit(), et sépare le
-- rapprochement LinkedIn (égalité stricte, pas besoin de trigram). Le partage
-- de nom de famille pseudo/nom réel (entity_name_shares_surname) ne sert plus
-- qu'au scoring de confiance sur l'ensemble déjà réduit, plus en filtre — il
-- n'est pas indexable et ferait retomber sur un scan complet.
create or replace function public.detect_contact_merge_candidates(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;

  perform extensions.set_limit(0.6);

  with name_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
      and public.normalize_entity_name(a.full_name) % public.normalize_entity_name(b.full_name)
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
  ),
  linkedin_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
      and b.linkedin_url = a.linkedin_url
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and a.linkedin_url is not null
  ),
  pairs as (
    select distinct least(contact_a_id, contact_b_id) as contact_a_id, greatest(contact_a_id, contact_b_id) as contact_b_id
    from name_matches
    union
    select distinct least(contact_a_id, contact_b_id), greatest(contact_a_id, contact_b_id)
    from linkedin_matches
  ),
  scored as (
    select
      p.contact_a_id, p.contact_b_id,
      a.full_name as name_a, b.full_name as name_b,
      a.email as email_a, b.email as email_b,
      a.linkedin_url as linkedin_a, b.linkedin_url as linkedin_b,
      a.company_id as company_a, b.company_id as company_b
    from pairs p
    join public.contacts a on a.id = p.contact_a_id
    join public.contacts b on b.id = p.contact_b_id
  )
  insert into public.contact_merge_suggestions (organization_id, contact_a_id, contact_b_id, confidence, evidence)
  select
    p_organization_id, contact_a_id, contact_b_id,
    case
      when linkedin_a is not null and linkedin_a = linkedin_b then 'high'
      when (public.entity_name_shares_surname(name_a, name_b) or public.entity_name_shares_surname(name_b, name_a))
        and company_a is not distinct from company_b and company_a is not null then 'high'
      when extensions.similarity(public.normalize_entity_name(name_a), public.normalize_entity_name(name_b)) >= 0.75 then 'high'
      else 'medium'
    end,
    jsonb_build_object(
      'name_similarity', round(extensions.similarity(public.normalize_entity_name(name_a), public.normalize_entity_name(name_b))::numeric, 2),
      'shares_surname', (public.entity_name_shares_surname(name_a, name_b) or public.entity_name_shares_surname(name_b, name_a)),
      'linkedin_match', (linkedin_a is not null and linkedin_a = linkedin_b),
      'same_company', (company_a is not distinct from company_b and company_a is not null),
      'contact_a_name', name_a, 'contact_b_name', name_b,
      'contact_a_email', email_a, 'contact_b_email', email_b
    )
  from scored
  where public.normalize_identity_email(email_a) is distinct from public.normalize_identity_email(email_b)
  on conflict (organization_id, contact_a_id, contact_b_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create index if not exists contacts_org_linkedin_idx
on public.contacts (organization_id, linkedin_url)
where linkedin_url is not null and merged_into_contact_id is null;
