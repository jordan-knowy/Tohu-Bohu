-- Un mot présent dans le nom de beaucoup de fiches du même org (ex. "Avocat"
-- répété dans 20 noms distincts d'un cabinet, "Cabinet" dans 50) gonfle la
-- similarité entre des personnes réellement différentes qui n'ont en commun
-- que ce suffixe générique. On calcule un "nom noyau" par contact (le nom
-- normalisé amputé des mots trop fréquents dans l'org) et on compare ce noyau
-- plutôt que le nom complet — ne change rien pour un nom sans terme partagé
-- (ex. "Fxravet81" vs "Fxravet"), cible spécifiquement le bruit constaté.
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
    select public.normalize_entity_name(full_name) as norm_name
    from public.contacts
    where organization_id = p_organization_id and merged_into_contact_id is null
    group by public.normalize_entity_name(full_name)
    having count(*) > 2
  ),
  name_tokens as (
    select c.id, tok.token, tok.ord
    from public.contacts c,
      lateral unnest(regexp_split_to_array(public.normalize_entity_name(c.full_name), '\s+')) with ordinality as tok(token, ord)
    where c.organization_id = p_organization_id
      and c.merged_into_contact_id is null
      and tok.token <> ''
  ),
  common_tokens as (
    select token from name_tokens
    group by token
    having count(distinct id) > 4
  ),
  core_names as (
    select nt.id, nullif(btrim(string_agg(nt.token, ' ' order by nt.ord)), '') as core_name
    from name_tokens nt
    where nt.token not in (select token from common_tokens)
    group by nt.id
  ),
  name_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join core_names ca on ca.id = a.id
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
    join core_names cb on cb.id = b.id
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and ca.core_name is not null
      and cb.core_name is not null
      and ca.core_name % cb.core_name
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(a.full_name))
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(b.full_name))
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
      coalesce(ca.core_name, public.normalize_entity_name(a.full_name)) as core_a,
      coalesce(cb.core_name, public.normalize_entity_name(b.full_name)) as core_b,
      a.email as email_a, b.email as email_b,
      a.linkedin_url as linkedin_a, b.linkedin_url as linkedin_b,
      a.company_id as company_a, b.company_id as company_b
    from pairs p
    join public.contacts a on a.id = p.contact_a_id
    join public.contacts b on b.id = p.contact_b_id
    left join core_names ca on ca.id = a.id
    left join core_names cb on cb.id = b.id
  )
  insert into public.contact_merge_suggestions (organization_id, contact_a_id, contact_b_id, confidence, evidence)
  select
    p_organization_id, contact_a_id, contact_b_id,
    case
      when linkedin_a is not null and linkedin_a = linkedin_b then 'high'
      when (public.entity_name_shares_surname(name_a, name_b) or public.entity_name_shares_surname(name_b, name_a))
        and company_a is not distinct from company_b and company_a is not null then 'high'
      when extensions.similarity(core_a, core_b) >= 0.75 then 'high'
      else 'medium'
    end,
    jsonb_build_object(
      'name_similarity', round(extensions.similarity(core_a, core_b)::numeric, 2),
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
