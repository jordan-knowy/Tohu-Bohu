-- Autorise le rapprochement prudent d'une seconde adresse professionnelle :
-- même nom complet, même compte, une seule fiche candidate.

create or replace function public.resolve_contact_identity(
  p_organization_id uuid,
  p_email text,
  p_full_name text,
  p_company_id uuid default null,
  p_owner_user_id uuid default null,
  p_role_title text default null,
  p_source text default 'unknown'
)
returns table (contact_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  normalized_email_value text := public.normalize_identity_email(p_email);
  normalized_name_value text := public.normalize_entity_name(p_full_name);
  resolved_id uuid;
begin
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;
  if normalized_email_value is null and normalized_name_value is null then
    raise exception 'Un email ou un nom est nécessaire pour résoudre une personne';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || '|contact|' ||
    coalesce(normalized_email_value, normalized_name_value || '|' || coalesce(p_company_id::text, 'sans-compte')),
    0
  ));

  if normalized_email_value is not null then
    select alias.contact_id into resolved_id
    from public.contact_identity_aliases alias
    join public.contacts contact on contact.id = alias.contact_id
    where alias.organization_id = p_organization_id
      and alias.identity_type = 'email'
      and alias.identity_value = normalized_email_value
      and contact.merged_into_contact_id is null
    limit 1;
  end if;

  if resolved_id is null and normalized_email_value is not null then
    select id into resolved_id
    from public.contacts
    where organization_id = p_organization_id
      and merged_into_contact_id is null
      and (
        public.normalize_identity_email(email) = normalized_email_value
        or exists (
          select 1 from unnest(coalesce(secondary_emails, array[]::text[])) secondary
          where public.normalize_identity_email(secondary) = normalized_email_value
        )
      )
    order by created_at
    limit 1;
  end if;

  if resolved_id is null
     and normalized_email_value is not null
     and p_company_id is not null
     and normalized_name_value like '% %'
     and (
       select count(*)
       from public.contacts
       where organization_id = p_organization_id
         and merged_into_contact_id is null
         and company_id = p_company_id
         and public.normalize_entity_name(full_name) = normalized_name_value
     ) = 1 then
    select id into resolved_id
    from public.contacts
    where organization_id = p_organization_id
      and merged_into_contact_id is null
      and company_id = p_company_id
      and public.normalize_entity_name(full_name) = normalized_name_value
    limit 1;
  end if;

  if resolved_id is null and normalized_email_value is null then
    select id into resolved_id
    from public.contacts
    where organization_id = p_organization_id
      and merged_into_contact_id is null
      and public.normalize_entity_name(full_name) = normalized_name_value
      and company_id is not distinct from p_company_id
    order by created_at
    limit 1;
  end if;

  if resolved_id is not null then
    update public.contacts
    set full_name = case
          when full_name = split_part(email, '@', 1)
            or length(full_name) < length(coalesce(nullif(btrim(p_full_name), ''), full_name))
          then coalesce(nullif(btrim(p_full_name), ''), full_name)
          else full_name
        end,
        email = coalesce(email, normalized_email_value),
        company_id = coalesce(company_id, p_company_id),
        owner_user_id = coalesce(owner_user_id, p_owner_user_id),
        role_title = coalesce(role_title, nullif(btrim(p_role_title), '')),
        secondary_emails = case
          when email is not null
            and normalized_email_value is not null
            and public.normalize_identity_email(email) <> normalized_email_value
            and not exists (
              select 1
              from unnest(coalesce(secondary_emails, array[]::text[])) secondary
              where public.normalize_identity_email(secondary) = normalized_email_value
            )
          then array_append(coalesce(secondary_emails, array[]::text[]), normalized_email_value)
          else secondary_emails
        end,
        source_summary = coalesce(source_summary, '{}'::jsonb)
          || jsonb_build_object('last_identity_source', p_source, 'last_identity_seen_at', now()),
        updated_at = now()
    where id = resolved_id;

    if normalized_email_value is not null then
      insert into public.contact_identity_aliases (
        organization_id, contact_id, identity_type, identity_value, source
      )
      values (
        p_organization_id, resolved_id, 'email', normalized_email_value, p_source
      )
      on conflict (organization_id, identity_type, identity_value) do update
      set contact_id = excluded.contact_id,
          source = excluded.source,
          last_seen_at = now();
    end if;

    return query select resolved_id, false;
    return;
  end if;

  insert into public.contacts (
    organization_id, company_id, owner_user_id, full_name, email, role_title, source_summary
  )
  values (
    p_organization_id,
    p_company_id,
    p_owner_user_id,
    coalesce(nullif(btrim(p_full_name), ''), split_part(coalesce(normalized_email_value, ''), '@', 1), 'Contact'),
    normalized_email_value,
    nullif(btrim(p_role_title), ''),
    jsonb_build_object('source', p_source, 'discovered_from', p_source)
  )
  returning id into resolved_id;

  if normalized_email_value is not null then
    insert into public.contact_identity_aliases (
      organization_id, contact_id, identity_type, identity_value, source
    )
    values (
      p_organization_id, resolved_id, 'email', normalized_email_value, p_source
    );
  end if;

  return query select resolved_id, true;
end;
$$;
