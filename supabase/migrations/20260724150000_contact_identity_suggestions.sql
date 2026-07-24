-- Résolution du vrai nom/prénom d'une personne (au lieu du pseudo dérivé de
-- l'email, ex. "Fxravet81") et détection de doublons inter-comptes (même
-- personne, emails différents — ex. Gmail perso + email pro) avec fusion
-- soumise à confirmation utilisateur (jamais automatique).
--
-- Deux tables de suggestions, jamais appliquées à l'aveugle :
-- - contact_name_suggestions : une meilleure valeur de full_name à valider.
-- - contact_merge_suggestions : une paire de fiches probablement identiques.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.contact_name_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  suggested_full_name text not null,
  source text not null check (source in ('enrichment_agent', 'signature')),
  evidence text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists contact_name_suggestions_contact_idx
on public.contact_name_suggestions (contact_id, status);

alter table public.contact_name_suggestions enable row level security;

drop policy if exists contact_name_suggestions_select_member on public.contact_name_suggestions;
create policy contact_name_suggestions_select_member
on public.contact_name_suggestions for select to authenticated
using (private.is_org_member(organization_id));

revoke all on public.contact_name_suggestions from public, anon, authenticated;
grant select on public.contact_name_suggestions to authenticated;
-- Seuls status/résolution sont modifiables par un membre — la proposition elle-même
-- (contact_id, suggested_full_name, evidence) est réservée à la service role.
grant update (status, resolved_at, resolved_by) on public.contact_name_suggestions to authenticated;
grant insert, update, delete on public.contact_name_suggestions to service_role;

create table if not exists public.contact_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_a_id uuid not null references public.contacts(id) on delete cascade,
  contact_b_id uuid not null references public.contacts(id) on delete cascade,
  confidence text not null check (confidence in ('high', 'medium')),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  check (contact_a_id < contact_b_id)
);

create unique index if not exists contact_merge_suggestions_pair_uidx
on public.contact_merge_suggestions (organization_id, contact_a_id, contact_b_id);

create index if not exists contact_merge_suggestions_status_idx
on public.contact_merge_suggestions (organization_id, status);

alter table public.contact_merge_suggestions enable row level security;

drop policy if exists contact_merge_suggestions_select_member on public.contact_merge_suggestions;
create policy contact_merge_suggestions_select_member
on public.contact_merge_suggestions for select to authenticated
using (private.is_org_member(organization_id));

revoke all on public.contact_merge_suggestions from public, anon, authenticated;
grant select on public.contact_merge_suggestions to authenticated;
grant update (status, resolved_at, resolved_by) on public.contact_merge_suggestions to authenticated;
grant insert, update, delete on public.contact_merge_suggestions to service_role;

-- Index trigram sur le nom normalisé (déjà utilisé par entity_identity_resolution)
-- pour accélérer la comparaison floue au fil de la croissance du nombre de contacts.
create index if not exists contacts_normalized_name_trgm_idx
on public.contacts using gin (public.normalize_entity_name(full_name) extensions.gin_trgm_ops);

-- Vrai si p_name_a est un nom "à un seul mot" (pseudo/local-part d'email, ex.
-- "fxravet81") qui contient un des mots (>=4 lettres) du nom complet p_name_b
-- (ex. "François-Xavier Ravet" -> "ravet"). Capture le cas d'un pseudo dérivé
-- d'un email personnel que la similarité trigram seule rate souvent (les deux
-- chaînes ont des longueurs et des jeux de trigrammes trop différents).
create or replace function public.entity_name_shares_surname(p_name_a text, p_name_b text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select
    array_length(regexp_split_to_array(public.normalize_entity_name(p_name_a), '\s+'), 1) = 1
    and array_length(regexp_split_to_array(public.normalize_entity_name(p_name_b), '\s+'), 1) > 1
    and exists (
      select 1
      from unnest(regexp_split_to_array(public.normalize_entity_name(p_name_b), '\s+')) as word
      where length(word) >= 4
        and position(word in public.normalize_entity_name(p_name_a)) > 0
        -- p_name_a doit contenir DAVANTAGE que le mot lui-même (ex. "fxravet81"
        -- contient "ravet" + du bruit) : un simple mot isolé identique à l'un des
        -- mots de p_name_b ("Montpellier" == le mot "Montpellier" dans "Montpellier
        -- Avocat") n'est pas un pseudo compressé, juste le même mot générique.
        and length(public.normalize_entity_name(p_name_a)) > length(word) + 1
    )
$$;

-- Détecte, pour un org donné, les paires de fiches actives probablement
-- identiques (même personne, comptes différents) et les enregistre comme
-- suggestions. N'écrit JAMAIS dans contacts ni n'appelle merge_contacts —
-- la fusion reste un acte confirmé par l'utilisateur (voir merge_contacts).
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

  with scored as (
    select
      a.id as contact_a_id,
      b.id as contact_b_id,
      case
        when a.linkedin_url is not null and a.linkedin_url = b.linkedin_url then 'high'
        when public.entity_name_shares_surname(a.full_name, b.full_name)
          or public.entity_name_shares_surname(b.full_name, a.full_name) then
          case when a.company_id is not distinct from b.company_id and a.company_id is not null then 'high' else 'medium' end
        else 'medium'
      end as confidence,
      jsonb_build_object(
        'name_similarity', round(extensions.similarity(public.normalize_entity_name(a.full_name), public.normalize_entity_name(b.full_name))::numeric, 2),
        'shares_surname', (public.entity_name_shares_surname(a.full_name, b.full_name) or public.entity_name_shares_surname(b.full_name, a.full_name)),
        'linkedin_match', (a.linkedin_url is not null and a.linkedin_url = b.linkedin_url),
        'same_company', (a.company_id is not distinct from b.company_id and a.company_id is not null),
        'contact_a_name', a.full_name, 'contact_b_name', b.full_name,
        'contact_a_email', a.email, 'contact_b_email', b.email
      ) as evidence
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id > a.id
      and b.merged_into_contact_id is null
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and public.normalize_identity_email(a.email) is distinct from public.normalize_identity_email(b.email)
      and (
        (a.linkedin_url is not null and a.linkedin_url = b.linkedin_url)
        or public.entity_name_shares_surname(a.full_name, b.full_name)
        or public.entity_name_shares_surname(b.full_name, a.full_name)
        or extensions.similarity(public.normalize_entity_name(a.full_name), public.normalize_entity_name(b.full_name)) >= 0.5
      )
  )
  insert into public.contact_merge_suggestions (organization_id, contact_a_id, contact_b_id, confidence, evidence)
  select p_organization_id, contact_a_id, contact_b_id, confidence, evidence
  from scored
  on conflict (organization_id, contact_a_id, contact_b_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.entity_name_shares_surname(text, text) from public, anon;
grant execute on function public.entity_name_shares_surname(text, text) to authenticated, service_role;
revoke all on function public.detect_contact_merge_candidates(uuid) from public, anon;
grant execute on function public.detect_contact_merge_candidates(uuid) to authenticated, service_role;
