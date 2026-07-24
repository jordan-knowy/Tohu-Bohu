-- Deux faux positifs massifs constatés en usage réel (org avec des cabinets
-- d'avocats) :
-- 1. linkedin_url pollué par des valeurs non-URL ("to_confirm", "N/A", "")
--    ou des pages ENTREPRISE (linkedin.com/company/...) partagées par plusieurs
--    contacts — traité à tort comme "même profil LinkedIn = même personne".
-- 2. Contacts nommés par une étiquette générique de boîte partagée ("Cabinet",
--    "Secrétariat", "Avocat" — 50, 12, 20 fiches respectivement dans un cas réel)
--    : leur similarité de nom entre eux est évidemment ~100%, sans rapport avec
--    de vrais doublons de personne.
--
-- Purge des suggestions déjà générées par la version bugguée (ne peuvent pas
-- être triées manuellement une par une, générées par un test de dev) et
-- correction du détecteur.

delete from public.contact_merge_suggestions where status = 'pending';

-- Nettoyage du champ pollué à sa source, pour ne pas re-polluer les futures
-- détections tant que la cause (agent d'enrichissement) est aussi corrigée
-- côté code (monitor-contacts).
update public.contacts
set linkedin_url = null
where linkedin_url is not null
  and linkedin_url !~* '^https?://([a-z]{2,3}\.)?linkedin\.com/in/';

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

  with common_names as (
    -- Un nom partagé par plus de 2 fiches actives du même org n'est pas un nom
    -- de personne mais une boîte générique (ex. "Cabinet", "Secrétariat") : on
    -- l'exclut du rapprochement par similarité de nom.
    select public.normalize_entity_name(full_name) as norm_name
    from public.contacts
    where organization_id = p_organization_id and merged_into_contact_id is null
    group by public.normalize_entity_name(full_name)
    having count(*) > 2
  ),
  name_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
      and public.normalize_entity_name(a.full_name) % public.normalize_entity_name(b.full_name)
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(a.full_name))
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(b.full_name))
  ),
  linkedin_matches as (
    -- Uniquement des profils PERSONNELS (linkedin.com/in/...), jamais une page
    -- entreprise ni une valeur non-URL — sinon tout le monde qui partage la
    -- même page société ou la même valeur par défaut se retrouve "matché".
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
      and b.linkedin_url = a.linkedin_url
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and a.linkedin_url ~* '^https?://([a-z]{2,3}\.)?linkedin\.com/in/'
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
