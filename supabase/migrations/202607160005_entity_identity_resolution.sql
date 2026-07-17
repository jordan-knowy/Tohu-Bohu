-- Résolution persistante des identités :
-- - une adresse email = une personne active par organisation ;
-- - un domaine canonique = un compte par organisation ;
-- - les anciennes fiches personnes en doublon restent traçables via
--   merged_into_contact_id, mais ne sont plus proposées dans l'application.

create or replace function public.normalize_identity_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '')
$$;

create or replace function public.normalize_company_domain(p_domain text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_domain, ''))), '^https?://', '', 'i'),
        '^www\.',
        '',
        'i'
      ),
      '[/#:?].*$',
      ''
    ),
    ''
  )
$$;

create extension if not exists unaccent with schema extensions;

-- `unaccent` n'est pas toujours exposé dans public : la fonction qualifiée
-- évite que le search_path d'une RPC change le résultat.
create or replace function public.normalize_entity_name(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_name, ''))), '[^[:alnum:]]+', ' ', 'g')), '')
$$;

alter table public.companies
  add column if not exists normalized_domain text,
  add column if not exists normalized_name text;

update public.companies
set normalized_domain = public.normalize_company_domain(domain),
    normalized_name = public.normalize_entity_name(name);

create or replace function public.normalize_company_identity()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.normalized_domain := public.normalize_company_domain(new.domain);
  new.normalized_name := public.normalize_entity_name(new.name);
  return new;
end;
$$;

drop trigger if exists normalize_company_identity on public.companies;
create trigger normalize_company_identity
before insert or update of name, domain on public.companies
for each row execute function public.normalize_company_identity();

create unique index if not exists companies_org_normalized_domain_uidx
on public.companies (organization_id, normalized_domain)
where normalized_domain is not null;

create index if not exists companies_org_normalized_name_idx
on public.companies (organization_id, normalized_name);

create table if not exists public.contact_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  identity_type text not null check (identity_type in ('email', 'linkedin')),
  identity_value text not null,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, identity_type, identity_value)
);

create index if not exists contact_identity_aliases_contact_idx
on public.contact_identity_aliases (contact_id);

alter table public.contact_identity_aliases enable row level security;

drop policy if exists contact_identity_aliases_select_member on public.contact_identity_aliases;
create policy contact_identity_aliases_select_member
on public.contact_identity_aliases for select to authenticated
using (private.is_org_member(organization_id));

-- Choisit la fiche la plus riche, puis la plus ancienne, pour chaque email.
create temporary table contact_merge_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into contact_merge_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    id,
    first_value(id) over (
      partition by organization_id, public.normalize_identity_email(email)
      order by
        (company_id is not null) desc,
        (owner_user_id is not null) desc,
        (linkedin_url is not null) desc,
        (role_title is not null) desc,
        created_at,
        id
    ) keeper_id,
    row_number() over (
      partition by organization_id, public.normalize_identity_email(email)
      order by
        (company_id is not null) desc,
        (owner_user_id is not null) desc,
        (linkedin_url is not null) desc,
        (role_title is not null) desc,
        created_at,
        id
    ) duplicate_rank
  from public.contacts
  where public.normalize_identity_email(email) is not null
    and merged_into_contact_id is null
) ranked
where duplicate_rank > 1;

-- Enrichit la fiche conservée avec les données utiles des doublons.
update public.contacts keeper
set
  company_id = coalesce(keeper.company_id, duplicate.company_id),
  owner_user_id = coalesce(keeper.owner_user_id, duplicate.owner_user_id),
  role_title = coalesce(keeper.role_title, duplicate.role_title),
  linkedin_url = coalesce(keeper.linkedin_url, duplicate.linkedin_url),
  avatar_url = coalesce(keeper.avatar_url, duplicate.avatar_url),
  location = coalesce(keeper.location, duplicate.location),
  web_bio = coalesce(keeper.web_bio, duplicate.web_bio),
  linkedin_headline = coalesce(keeper.linkedin_headline, duplicate.linkedin_headline),
  secondary_emails = array(
    select distinct email_value
    from unnest(
      coalesce(keeper.secondary_emails, array[]::text[])
      || coalesce(duplicate.secondary_emails, array[]::text[])
      || array[duplicate.email]
    ) email_value
    where public.normalize_identity_email(email_value) is not null
      and public.normalize_identity_email(email_value) <> public.normalize_identity_email(keeper.email)
  ),
  source_summary = coalesce(keeper.source_summary, '{}'::jsonb)
    || jsonb_build_object('identity_merged_at', now()),
  updated_at = now()
from contact_merge_map mapping
join public.contacts duplicate on duplicate.id = mapping.duplicate_id
where keeper.id = mapping.keeper_id;

-- Les messages doivent immédiatement alimenter le corpus de la fiche unique.
update public.communication_messages message
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where message.contact_id = mapping.duplicate_id;

update public.ai_usage_events event
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where event.contact_id = mapping.duplicate_id;

update public.home_action_states action
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where action.contact_id = mapping.duplicate_id;

update public.contact_transfers transfer
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where transfer.contact_id = mapping.duplicate_id;

-- Fusion des signaux : rattache les validations/actions avant suppression
-- lorsqu'un signal identique existe déjà sur la fiche conservée.
create temporary table behavioral_signal_merge_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into behavioral_signal_merge_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    signal.id,
    first_value(signal.id) over (
      partition by
        signal.organization_id,
        coalesce(contact_mapping.keeper_id, signal.contact_id),
        signal.deduplication_key
      order by signal.first_seen_at, signal.created_at, signal.id
    ) keeper_id,
    row_number() over (
      partition by
        signal.organization_id,
        coalesce(contact_mapping.keeper_id, signal.contact_id),
        signal.deduplication_key
      order by signal.first_seen_at, signal.created_at, signal.id
    ) duplicate_rank
  from public.behavioral_signals signal
  left join contact_merge_map contact_mapping
    on contact_mapping.duplicate_id = signal.contact_id
) ranked
where duplicate_rank > 1;

insert into public.signal_feedback (
  organization_id, signal_id, user_id, verdict, created_at, updated_at
)
select distinct on (feedback.organization_id, mapping.keeper_id, feedback.user_id)
  feedback.organization_id,
  mapping.keeper_id,
  feedback.user_id,
  feedback.verdict,
  feedback.created_at,
  feedback.updated_at
from public.signal_feedback feedback
join behavioral_signal_merge_map mapping on mapping.duplicate_id = feedback.signal_id
order by feedback.organization_id, mapping.keeper_id, feedback.user_id, feedback.updated_at desc
on conflict (user_id, signal_id) do update
set verdict = case
      when excluded.updated_at >= signal_feedback.updated_at then excluded.verdict
      else signal_feedback.verdict
    end,
    updated_at = greatest(signal_feedback.updated_at, excluded.updated_at);

delete from public.signal_feedback feedback
using behavioral_signal_merge_map mapping
where feedback.signal_id = mapping.duplicate_id;

update public.home_action_states action
set source_signal_id = mapping.keeper_id
from behavioral_signal_merge_map mapping
where action.source_signal_id = mapping.duplicate_id;

update public.behavioral_signals keeper
set duplicate_count = keeper.duplicate_count + duplicate.duplicate_count + 1,
    first_seen_at = least(keeper.first_seen_at, duplicate.first_seen_at),
    last_seen_at = greatest(keeper.last_seen_at, duplicate.last_seen_at),
    confidence = greatest(keeper.confidence, duplicate.confidence)
from behavioral_signal_merge_map mapping
join public.behavioral_signals duplicate on duplicate.id = mapping.duplicate_id
where keeper.id = mapping.keeper_id;

delete from public.behavioral_signals signal
using behavioral_signal_merge_map mapping
where signal.id = mapping.duplicate_id;

update public.behavioral_signals signal
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where signal.contact_id = mapping.duplicate_id;

-- Un profil cognitif maximum par version sur la fiche finale.
create temporary table cognitive_profile_merge_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into cognitive_profile_merge_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    profile.id,
    first_value(profile.id) over (
      partition by
        profile.organization_id,
        coalesce(contact_mapping.keeper_id, profile.contact_id),
        profile.profile_version
      order by profile.global_confidence desc nulls last, profile.updated_at desc, profile.id
    ) keeper_id,
    row_number() over (
      partition by
        profile.organization_id,
        coalesce(contact_mapping.keeper_id, profile.contact_id),
        profile.profile_version
      order by profile.global_confidence desc nulls last, profile.updated_at desc, profile.id
    ) duplicate_rank
  from public.cognitive_profiles profile
  left join contact_merge_map contact_mapping
    on contact_mapping.duplicate_id = profile.contact_id
) ranked
where duplicate_rank > 1;

update public.behavioral_signals signal
set profile_id = mapping.keeper_id
from cognitive_profile_merge_map mapping
where signal.profile_id = mapping.duplicate_id;

delete from public.cognitive_profiles profile
using cognitive_profile_merge_map mapping
where profile.id = mapping.duplicate_id;

update public.cognitive_profiles profile
set contact_id = mapping.keeper_id
from contact_merge_map mapping
where profile.contact_id = mapping.duplicate_id;

-- Les tables sans conflit d'unicité sont simplement rattachées.
update public.relationship_snapshots row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;

create temporary table contact_score_merge_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into contact_score_merge_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    score.id,
    first_value(score.id) over (
      partition by
        score.organization_id,
        coalesce(contact_mapping.keeper_id, score.contact_id),
        score.user_id,
        score.snapshot_date
      order by score.created_at desc, score.id
    ) keeper_id,
    row_number() over (
      partition by
        score.organization_id,
        coalesce(contact_mapping.keeper_id, score.contact_id),
        score.user_id,
        score.snapshot_date
      order by score.created_at desc, score.id
    ) duplicate_rank
  from public.contact_score_history score
  left join contact_merge_map contact_mapping
    on contact_mapping.duplicate_id = score.contact_id
) ranked
where duplicate_rank > 1;

delete from public.contact_score_history score
using contact_score_merge_map mapping
where score.id = mapping.duplicate_id;

update public.contact_score_history row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;
update public.contact_alerts row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;
update public.contact_career_path row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;
update public.notes row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;

-- Les participants peuvent avoir une contrainte réunion/contact.
delete from public.meeting_participants duplicate
using contact_merge_map mapping
where duplicate.contact_id = mapping.duplicate_id
  and exists (
    select 1 from public.meeting_participants keeper
    where keeper.meeting_id = duplicate.meeting_id
      and keeper.contact_id = mapping.keeper_id
  );
update public.meeting_participants row_value set contact_id = mapping.keeper_id
from contact_merge_map mapping where row_value.contact_id = mapping.duplicate_id;

-- Conserve la redirection au lieu de supprimer la fiche historique.
update public.contacts duplicate
set merged_into_contact_id = mapping.keeper_id,
    updated_at = now(),
    source_summary = coalesce(duplicate.source_summary, '{}'::jsonb)
      || jsonb_build_object('merged_reason', 'same_normalized_email', 'merged_at', now())
from contact_merge_map mapping
where duplicate.id = mapping.duplicate_id;

-- Alias de toutes les adresses principales et secondaires connues.
insert into public.contact_identity_aliases (
  organization_id, contact_id, identity_type, identity_value, source
)
select distinct on (
  contact.organization_id,
  public.normalize_identity_email(email_value)
)
  contact.organization_id,
  coalesce(contact.merged_into_contact_id, contact.id),
  'email',
  public.normalize_identity_email(email_value),
  'migration'
from public.contacts contact
cross join lateral unnest(
  array[contact.email] || coalesce(contact.secondary_emails, array[]::text[])
) email_value
where public.normalize_identity_email(email_value) is not null
order by
  contact.organization_id,
  public.normalize_identity_email(email_value),
  (contact.merged_into_contact_id is null) desc,
  contact.created_at
on conflict (organization_id, identity_type, identity_value) do update
set contact_id = excluded.contact_id,
    last_seen_at = now();

create unique index if not exists contacts_org_active_email_uidx
on public.contacts (organization_id, public.normalize_identity_email(email))
where merged_into_contact_id is null
  and public.normalize_identity_email(email) is not null;

create or replace function public.resolve_company_identity(
  p_organization_id uuid,
  p_name text,
  p_domain text default null,
  p_industry text default null,
  p_create_if_missing boolean default true
)
returns table (company_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  normalized_domain_value text := public.normalize_company_domain(p_domain);
  normalized_name_value text := public.normalize_entity_name(p_name);
  resolved_id uuid;
begin
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || '|company|' ||
    coalesce(normalized_domain_value, normalized_name_value, ''),
    0
  ));

  if normalized_domain_value is not null then
    select id into resolved_id
    from public.companies
    where organization_id = p_organization_id
      and normalized_domain = normalized_domain_value
    order by created_at
    limit 1;
  end if;

  if resolved_id is null and normalized_name_value is not null then
    select id into resolved_id
    from public.companies
    where organization_id = p_organization_id
      and normalized_name = normalized_name_value
    order by created_at
    limit 1;
  end if;

  if resolved_id is not null then
    update public.companies
    set domain = coalesce(domain, normalized_domain_value),
        industry = coalesce(industry, p_industry),
        updated_at = now()
    where id = resolved_id;
    return query select resolved_id, false;
    return;
  end if;

  if not p_create_if_missing then return; end if;

  insert into public.companies (
    organization_id, name, domain, industry, public_context, is_tracked
  )
  values (
    p_organization_id,
    coalesce(nullif(btrim(p_name), ''), normalized_domain_value, 'Organisation'),
    normalized_domain_value,
    nullif(btrim(p_industry), ''),
    '{}'::jsonb,
    false
  )
  returning id into resolved_id;

  return query select resolved_id, true;
end;
$$;

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

  -- Une adresse différente peut être un alias professionnel. On ne fusionne
  -- que si le nom complet (au moins deux mots) et le compte correspondent,
  -- et qu'une seule fiche candidate existe : aucun rapprochement ambigu.
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

  -- Sans email, on ne fusionne que sur nom exact normalisé + même compte.
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
    organization_id,
    company_id,
    owner_user_id,
    full_name,
    email,
    role_title,
    source_summary
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

revoke all on function public.resolve_company_identity(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.resolve_company_identity(uuid, text, text, text, boolean) to authenticated, service_role;
revoke all on function public.resolve_contact_identity(uuid, text, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.resolve_contact_identity(uuid, text, text, uuid, uuid, text, text) to authenticated, service_role;
