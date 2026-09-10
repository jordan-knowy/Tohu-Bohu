-- Fiches partagées : une identité canonique, plusieurs visions personnelles.
--
-- Une passation change uniquement l'owner officiel. La vision de l'ancien
-- owner reste intacte, le nouveau reçoit une vision vide et un accès en
-- lecture seule à la vision transmise. Chaque vision pilote sa propre
-- visibilité (organisation ou membres explicitement autorisés).

create table if not exists public.fiche_visions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'company')),
  entity_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'restricted')),
  relationship_state text not null default 'active' check (relationship_state in ('active', 'relationship_to_build')),
  created_reason text not null default 'existing' check (created_reason in ('existing', 'handover', 'share', 'discovery')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type, entity_id, owner_user_id)
);

create index if not exists fiche_visions_entity_idx
  on public.fiche_visions (organization_id, entity_type, entity_id);
create index if not exists fiche_visions_owner_idx
  on public.fiche_visions (owner_user_id, organization_id);

create table if not exists public.fiche_vision_grants (
  vision_id uuid not null references public.fiche_visions(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null default 'manual' check (reason in ('manual', 'handover')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (vision_id, grantee_user_id)
);

create index if not exists fiche_vision_grants_grantee_idx
  on public.fiche_vision_grants (grantee_user_id, vision_id)
  where revoked_at is null;

create table if not exists public.fiche_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'company')),
  entity_id uuid not null,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  scope text not null check (scope in ('entity_only', 'account_and_people')),
  note text,
  transferred_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists fiche_handovers_entity_idx
  on public.fiche_handovers (organization_id, entity_type, entity_id, created_at desc);

-- Backfill : la configuration actuelle devient la première vision personnelle.
insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select
  contact.organization_id,
  'contact',
  contact.id,
  coalesce(settings.primary_owner_user_id, contact.owner_user_id, fallback.user_id),
  coalesce(settings.visibility, 'workspace'),
  'active',
  'existing'
from public.contacts contact
left join public.person_settings settings
  on settings.organization_id = contact.organization_id and settings.contact_id = contact.id
left join lateral (
  select membership.user_id
  from public.memberships membership
  where membership.organization_id = contact.organization_id
  order by (membership.role = 'owner') desc, membership.created_at
  limit 1
) fallback on true
where contact.merged_into_contact_id is null
  and coalesce(settings.primary_owner_user_id, contact.owner_user_id, fallback.user_id) is not null
on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

-- Une vision existe aussi pour chaque membre dont une source personnelle est
-- déjà présente. Cela fait apparaître « Moi | Jordan | Maxime » sans dupliquer
-- l'identité et sans attribuer les emails de l'un à l'autre.
insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select distinct
  message.organization_id,
  'contact',
  message.contact_id,
  (message.metadata ->> 'user_id')::uuid,
  'workspace',
  'active',
  'discovery'
from public.communication_messages message
join public.memberships member
  on member.organization_id = message.organization_id
 and member.user_id::text = message.metadata ->> 'user_id'
where message.contact_id is not null
  and message.metadata ->> 'user_id' ~* '^[0-9a-f-]{36}$'
on conflict (organization_id, entity_type, entity_id, owner_user_id)
do update set relationship_state = 'active', updated_at = now();

insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select distinct
  message.organization_id,
  'company',
  contact.company_id,
  (message.metadata ->> 'user_id')::uuid,
  'workspace',
  'active',
  'discovery'
from public.communication_messages message
join public.contacts contact on contact.id = message.contact_id
join public.memberships member
  on member.organization_id = message.organization_id
 and member.user_id::text = message.metadata ->> 'user_id'
where contact.company_id is not null
  and message.metadata ->> 'user_id' ~* '^[0-9a-f-]{36}$'
on conflict (organization_id, entity_type, entity_id, owner_user_id)
do update set relationship_state = 'active', updated_at = now();

insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select distinct
  meeting.organization_id,
  'company',
  meeting.company_id,
  meeting.owner_user_id,
  'workspace',
  'active',
  'discovery'
from public.meetings meeting
join public.memberships member
  on member.organization_id = meeting.organization_id and member.user_id = meeting.owner_user_id
where meeting.company_id is not null and meeting.owner_user_id is not null
on conflict (organization_id, entity_type, entity_id, owner_user_id)
do update set relationship_state = 'active', updated_at = now();

insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select distinct
  participant.organization_id,
  'contact',
  participant.contact_id,
  meeting.owner_user_id,
  'workspace',
  'active',
  'discovery'
from public.meeting_participants participant
join public.meetings meeting on meeting.id = participant.meeting_id
join public.memberships member
  on member.organization_id = participant.organization_id and member.user_id = meeting.owner_user_id
where participant.contact_id is not null and meeting.owner_user_id is not null
on conflict (organization_id, entity_type, entity_id, owner_user_id)
do update set relationship_state = 'active', updated_at = now();

create or replace function public.ensure_fiche_vision_from_interaction()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_owner_user_id uuid;
  v_company_id uuid;
  v_organization_id uuid;
  v_contact_id uuid;
begin
  if tg_table_name = 'communication_messages' then
    if new.metadata ->> 'user_id' !~* '^[0-9a-f-]{36}$' or new.contact_id is null then return new; end if;
    v_owner_user_id := (new.metadata ->> 'user_id')::uuid;
    v_organization_id := new.organization_id;
    v_contact_id := new.contact_id;
    select contact.company_id into v_company_id from public.contacts contact where contact.id = new.contact_id;
  elsif tg_table_name = 'meetings' then
    if new.owner_user_id is null or new.company_id is null then return new; end if;
    v_owner_user_id := new.owner_user_id;
    v_organization_id := new.organization_id;
    v_company_id := new.company_id;
  else
    if new.contact_id is null then return new; end if;
    select meeting.owner_user_id, meeting.organization_id, meeting.company_id
    into v_owner_user_id, v_organization_id, v_company_id
    from public.meetings meeting where meeting.id = new.meeting_id;
    v_contact_id := new.contact_id;
  end if;

  if v_owner_user_id is null or not exists (
    select 1 from public.memberships member
    where member.organization_id = v_organization_id and member.user_id = v_owner_user_id
  ) then return new; end if;

  if v_contact_id is not null then
    insert into public.fiche_visions (
      organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
    ) values (v_organization_id, 'contact', v_contact_id, v_owner_user_id, 'workspace', 'active', 'discovery')
    on conflict (organization_id, entity_type, entity_id, owner_user_id)
    do update set relationship_state = 'active', updated_at = now();
  end if;

  if v_company_id is not null then
    insert into public.fiche_visions (
      organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
    ) values (v_organization_id, 'company', v_company_id, v_owner_user_id, 'workspace', 'active', 'discovery')
    on conflict (organization_id, entity_type, entity_id, owner_user_id)
    do update set relationship_state = 'active', updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists communication_messages_ensure_fiche_vision on public.communication_messages;
create trigger communication_messages_ensure_fiche_vision
after insert or update of contact_id, metadata on public.communication_messages
for each row execute function public.ensure_fiche_vision_from_interaction();

drop trigger if exists meetings_ensure_fiche_vision on public.meetings;
create trigger meetings_ensure_fiche_vision
after insert or update of owner_user_id, company_id on public.meetings
for each row execute function public.ensure_fiche_vision_from_interaction();

drop trigger if exists meeting_participants_ensure_fiche_vision on public.meeting_participants;
create trigger meeting_participants_ensure_fiche_vision
after insert or update of contact_id, meeting_id on public.meeting_participants
for each row execute function public.ensure_fiche_vision_from_interaction();

insert into public.fiche_visions (
  organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
)
select
  company.organization_id,
  'company',
  company.id,
  coalesce(settings.primary_owner_user_id, contact_owner.owner_user_id, fallback.user_id),
  coalesce(settings.visibility, 'workspace'),
  'active',
  'existing'
from public.companies company
left join public.account_settings settings
  on settings.organization_id = company.organization_id and settings.company_id = company.id
left join lateral (
  select contact.owner_user_id
  from public.contacts contact
  where contact.organization_id = company.organization_id
    and contact.company_id = company.id
    and contact.owner_user_id is not null
    and contact.merged_into_contact_id is null
  group by contact.owner_user_id
  order by count(*) desc
  limit 1
) contact_owner on true
left join lateral (
  select membership.user_id
  from public.memberships membership
  where membership.organization_id = company.organization_id
  order by (membership.role = 'owner') desc, membership.created_at
  limit 1
) fallback on true
where coalesce(settings.primary_owner_user_id, contact_owner.owner_user_id, fallback.user_id) is not null
on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

-- L'owner officiel reste un concept distinct de la vision. On complète les
-- anciennes lignes qui n'avaient pas encore d'affectation explicite.
insert into public.person_settings (
  organization_id, contact_id, primary_owner_user_id, updated_by, updated_at
)
select contact.organization_id, contact.id, contact.owner_user_id, contact.owner_user_id, now()
from public.contacts contact
where contact.owner_user_id is not null and contact.merged_into_contact_id is null
on conflict (organization_id, contact_id)
do update set
  primary_owner_user_id = coalesce(public.person_settings.primary_owner_user_id, excluded.primary_owner_user_id),
  updated_at = case when public.person_settings.primary_owner_user_id is null then now() else public.person_settings.updated_at end;

insert into public.account_settings (
  organization_id, company_id, primary_owner_user_id, updated_by, updated_at
)
select
  company.organization_id,
  company.id,
  coalesce(company.tracked_by, first_vision.owner_user_id),
  coalesce(company.tracked_by, first_vision.owner_user_id),
  now()
from public.companies company
left join lateral (
  select vision.owner_user_id
  from public.fiche_visions vision
  where vision.organization_id = company.organization_id
    and vision.entity_type = 'company'
    and vision.entity_id = company.id
  order by vision.created_at
  limit 1
) first_vision on true
where coalesce(company.tracked_by, first_vision.owner_user_id) is not null
on conflict (organization_id, company_id)
do update set
  primary_owner_user_id = coalesce(public.account_settings.primary_owner_user_id, excluded.primary_owner_user_id),
  updated_at = case when public.account_settings.primary_owner_user_id is null then now() else public.account_settings.updated_at end;

create or replace function private.can_view_fiche_vision(
  p_vision_id uuid,
  p_viewer_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.fiche_visions vision
    where vision.id = p_vision_id
      and exists (
        select 1 from public.memberships member
        where member.organization_id = vision.organization_id
          and member.user_id = p_viewer_user_id
      )
      and (
        vision.owner_user_id = p_viewer_user_id
        or vision.visibility = 'workspace'
        or exists (
          select 1 from public.fiche_vision_grants grant_row
          where grant_row.vision_id = vision.id
            and grant_row.grantee_user_id = p_viewer_user_id
            and grant_row.revoked_at is null
        )
      )
  );
$$;

create or replace function private.can_view_fiche_vision_owner(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_owner_user_id uuid,
  p_viewer_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.fiche_visions vision
    where vision.organization_id = p_organization_id
      and vision.entity_type = p_entity_type
      and vision.entity_id = p_entity_id
      and vision.owner_user_id = p_owner_user_id
      and private.can_view_fiche_vision(vision.id, p_viewer_user_id)
  );
$$;

create or replace function private.can_view_fiche_entity(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_viewer_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.is_org_member(p_organization_id)
    and (
      not exists (
        select 1 from public.fiche_visions vision
        where vision.organization_id = p_organization_id
          and vision.entity_type = p_entity_type
          and vision.entity_id = p_entity_id
      )
      or exists (
        select 1 from public.fiche_visions vision
        where vision.organization_id = p_organization_id
          and vision.entity_type = p_entity_type
          and vision.entity_id = p_entity_id
          and private.can_view_fiche_vision(vision.id, p_viewer_user_id)
      )
    );
$$;

create or replace function private.can_view_fiche_meeting(
  p_meeting_id uuid,
  p_viewer_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.meetings meeting
    where meeting.id = p_meeting_id
      and private.is_org_member(meeting.organization_id)
      and (
        meeting.owner_user_id is null
        or meeting.owner_user_id = p_viewer_user_id
        or (
          meeting.company_id is not null
          and private.can_view_fiche_vision_owner(
            meeting.organization_id, 'company', meeting.company_id,
            meeting.owner_user_id, p_viewer_user_id
          )
        )
        or exists (
          select 1 from public.meeting_participants participant
          where participant.meeting_id = meeting.id
            and participant.contact_id is not null
            and private.can_view_fiche_vision_owner(
              meeting.organization_id, 'contact', participant.contact_id,
              meeting.owner_user_id, p_viewer_user_id
            )
        )
      )
  );
$$;

revoke all on function private.can_view_fiche_vision(uuid, uuid) from public, anon;
revoke all on function private.can_view_fiche_vision_owner(uuid, text, uuid, uuid, uuid) from public, anon;
revoke all on function private.can_view_fiche_entity(uuid, text, uuid, uuid) from public, anon;
revoke all on function private.can_view_fiche_meeting(uuid, uuid) from public, anon;
grant execute on function private.can_view_fiche_vision(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_view_fiche_vision_owner(uuid, text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_view_fiche_entity(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_view_fiche_meeting(uuid, uuid) to authenticated, service_role;

alter table public.fiche_visions enable row level security;
alter table public.fiche_vision_grants enable row level security;
alter table public.fiche_handovers enable row level security;

drop policy if exists fiche_visions_select on public.fiche_visions;
create policy fiche_visions_select on public.fiche_visions
  for select to authenticated
  using (private.can_view_fiche_vision(id));

drop policy if exists fiche_visions_owner_insert on public.fiche_visions;
create policy fiche_visions_owner_insert on public.fiche_visions
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists fiche_visions_owner_update on public.fiche_visions;
create policy fiche_visions_owner_update on public.fiche_visions
  for update to authenticated
  using (owner_user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (owner_user_id = (select auth.uid()) and private.is_org_member(organization_id));

drop policy if exists fiche_vision_grants_participant_select on public.fiche_vision_grants;
create policy fiche_vision_grants_participant_select on public.fiche_vision_grants
  for select to authenticated
  using (
    grantee_user_id = (select auth.uid())
    or exists (
      select 1 from public.fiche_visions vision
      where vision.id = vision_id and vision.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists fiche_handovers_member_select on public.fiche_handovers;
create policy fiche_handovers_member_select on public.fiche_handovers
  for select to authenticated
  using (private.is_org_member(organization_id));

-- Les anciens verrous portaient sur toute l'identité et pouvaient donc cacher
-- aussi la vision personnelle d'un autre membre. Ils sont remplacés par les
-- droits ci-dessus. Les DROP sont sûrs même si les migrations historiques ont
-- été appliquées directement sur le projet distant.
drop policy if exists contacts_lock_restrictive on public.contacts;
drop policy if exists companies_lock_restrictive on public.companies;

-- L'identité elle-même n'est visible que lorsqu'au moins une vision l'est.
drop policy if exists contacts_member_all on public.contacts;
drop policy if exists companies_member_all on public.companies;

create policy contacts_visible_select on public.contacts
  for select to authenticated
  using (private.can_view_fiche_entity(organization_id, 'contact', id));
create policy contacts_vision_restrictive on public.contacts
  as restrictive for select to authenticated
  using (private.can_view_fiche_entity(organization_id, 'contact', id));
create policy contacts_member_insert on public.contacts
  for insert to authenticated with check (private.is_org_member(organization_id));
create policy contacts_member_update on public.contacts
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy contacts_member_delete on public.contacts
  for delete to authenticated using (private.is_org_member(organization_id));

create policy companies_visible_select on public.companies
  for select to authenticated
  using (private.can_view_fiche_entity(organization_id, 'company', id));
create policy companies_vision_restrictive on public.companies
  as restrictive for select to authenticated
  using (private.can_view_fiche_entity(organization_id, 'company', id));
create policy companies_member_insert on public.companies
  for insert to authenticated with check (private.is_org_member(organization_id));
create policy companies_member_update on public.companies
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy companies_member_delete on public.companies
  for delete to authenticated using (private.is_org_member(organization_id));

-- Les sources déjà porteuses d'un user_id sont filtrées par vision à la base :
-- avoir sa propre vision ne donne pas accès aux échanges restreints d'un autre.
drop policy if exists communication_messages_vision_restrictive on public.communication_messages;
create policy communication_messages_vision_restrictive on public.communication_messages
  as restrictive for select to authenticated
  using (
    contact_id is null
    or metadata ->> 'user_id' is null
    or private.can_view_fiche_vision_owner(
      organization_id,
      'contact',
      contact_id,
      case when metadata ->> 'user_id' ~* '^[0-9a-f-]{36}$' then (metadata ->> 'user_id')::uuid else null end
    )
  );

drop policy if exists contact_score_history_vision_restrictive on public.contact_score_history;
create policy contact_score_history_vision_restrictive on public.contact_score_history
  as restrictive for select to authenticated
  using (private.can_view_fiche_vision_owner(organization_id, 'contact', contact_id, user_id));

drop policy if exists person_memory_entries_vision_restrictive on public.person_memory_entries;
create policy person_memory_entries_vision_restrictive on public.person_memory_entries
  as restrictive for select to authenticated
  using (private.can_view_fiche_vision_owner(organization_id, 'contact', contact_id, author_user_id));

drop policy if exists account_memory_entries_vision_restrictive on public.account_memory_entries;
create policy account_memory_entries_vision_restrictive on public.account_memory_entries
  as restrictive for select to authenticated
  using (private.can_view_fiche_vision_owner(organization_id, 'company', company_id, author_user_id));

drop policy if exists meetings_vision_restrictive on public.meetings;
create policy meetings_vision_restrictive on public.meetings
  as restrictive for select to authenticated
  using (private.can_view_fiche_meeting(id));

drop policy if exists meeting_participants_vision_restrictive on public.meeting_participants;
create policy meeting_participants_vision_restrictive on public.meeting_participants
  as restrictive for select to authenticated
  using (private.can_view_fiche_meeting(meeting_id));

drop policy if exists meeting_transcripts_vision_restrictive on public.meeting_transcripts;
create policy meeting_transcripts_vision_restrictive on public.meeting_transcripts
  as restrictive for select to authenticated
  using (meeting_id is null or private.can_view_fiche_meeting(meeting_id));

-- Lecture et création paresseuse de « Ma vision » lors de la première ouverture.
drop function if exists public.list_fiche_visions(uuid, uuid);
create or replace function public.list_fiche_visions(p_organization_id uuid, p_contact_id uuid)
returns table (
  organization_id uuid,
  contact_id uuid,
  is_mine boolean,
  owner_user_id uuid,
  owner_name text,
  share_note text,
  visibility text,
  relationship_state text
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not private.can_view_fiche_entity(p_organization_id, 'contact', p_contact_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id,
    visibility, relationship_state, created_reason
  ) values (
    p_organization_id, 'contact', p_contact_id, auth.uid(),
    'restricted', 'relationship_to_build', 'discovery'
  ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

  return query
  select
    vision.organization_id,
    vision.entity_id,
    vision.owner_user_id = auth.uid(),
    vision.owner_user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Membre'),
    null::text,
    vision.visibility,
    vision.relationship_state
  from public.fiche_visions vision
  left join public.profiles profile on profile.id = vision.owner_user_id
  where vision.organization_id = p_organization_id
    and vision.entity_type = 'contact'
    and vision.entity_id = p_contact_id
    and private.can_view_fiche_vision(vision.id)
  order by (vision.owner_user_id = auth.uid()) desc, lower(coalesce(profile.full_name, ''));
end;
$$;

drop function if exists public.list_account_visions(uuid, uuid);
create or replace function public.list_account_visions(p_organization_id uuid, p_company_id uuid)
returns table (
  organization_id uuid,
  company_id uuid,
  is_mine boolean,
  owner_user_id uuid,
  owner_name text,
  share_note text,
  visibility text,
  relationship_state text
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not private.can_view_fiche_entity(p_organization_id, 'company', p_company_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id,
    visibility, relationship_state, created_reason
  ) values (
    p_organization_id, 'company', p_company_id, auth.uid(),
    'restricted', 'relationship_to_build', 'discovery'
  ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

  return query
  select
    vision.organization_id,
    vision.entity_id,
    vision.owner_user_id = auth.uid(),
    vision.owner_user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Membre'),
    null::text,
    vision.visibility,
    vision.relationship_state
  from public.fiche_visions vision
  left join public.profiles profile on profile.id = vision.owner_user_id
  where vision.organization_id = p_organization_id
    and vision.entity_type = 'company'
    and vision.entity_id = p_company_id
    and private.can_view_fiche_vision(vision.id)
  order by (vision.owner_user_id = auth.uid()) desc, lower(coalesce(profile.full_name, ''));
end;
$$;

create or replace function public.set_fiche_vision_visibility(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_entity_type not in ('contact', 'company') or p_visibility not in ('workspace', 'restricted') then
    raise exception 'Invalid visibility';
  end if;
  if not private.is_org_member(p_organization_id) then raise exception 'Not authorized'; end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
  ) values (
    p_organization_id, p_entity_type, p_entity_id, auth.uid(), p_visibility, 'active', 'existing'
  )
  on conflict (organization_id, entity_type, entity_id, owner_user_id)
  do update set visibility = excluded.visibility, updated_at = now();
end;
$$;

create or replace function public.list_fiche_vision_grants(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns table (grantee_user_id uuid)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select grant_row.grantee_user_id
  from public.fiche_visions vision
  join public.fiche_vision_grants grant_row on grant_row.vision_id = vision.id
  where vision.organization_id = p_organization_id
    and vision.entity_type = p_entity_type
    and vision.entity_id = p_entity_id
    and vision.owner_user_id = auth.uid()
    and grant_row.revoked_at is null
    and private.is_org_member(p_organization_id);
$$;

create or replace function public.set_fiche_vision_grant(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_grantee_user_id uuid,
  p_allowed boolean
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vision_id uuid;
begin
  if p_entity_type not in ('contact', 'company') or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from public.memberships member
    where member.organization_id = p_organization_id and member.user_id = p_grantee_user_id
  ) then raise exception 'Target user is not a member of this organization'; end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id, visibility, relationship_state, created_reason
  ) values (
    p_organization_id, p_entity_type, p_entity_id, auth.uid(), 'restricted', 'active', 'existing'
  )
  on conflict (organization_id, entity_type, entity_id, owner_user_id)
  do update set visibility = 'restricted', updated_at = now()
  returning id into v_vision_id;

  if p_allowed then
    insert into public.fiche_vision_grants (vision_id, grantee_user_id, granted_by, reason, revoked_at)
    values (v_vision_id, p_grantee_user_id, auth.uid(), 'manual', null)
    on conflict (vision_id, grantee_user_id)
    do update set revoked_at = null, granted_at = now(), granted_by = auth.uid(), reason = 'manual';
  else
    update public.fiche_vision_grants
    set revoked_at = now()
    where vision_id = v_vision_id and grantee_user_id = p_grantee_user_id;
  end if;
end;
$$;

-- Partage ciblé conservé pour les actions existantes : il partage la vision
-- de l'expéditeur en lecture seule et prépare une « Ma vision » vide chez le
-- destinataire. Il ne change jamais l'owner officiel.
drop function if exists public.share_fiche(uuid, text, uuid, uuid, text);
create or replace function public.share_fiche(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_to_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vision_id uuid;
begin
  if p_entity_type not in ('contact', 'company') or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from public.memberships member
    where member.organization_id = p_organization_id and member.user_id = p_to_user_id
  ) then raise exception 'Target user is not a member of this organization'; end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id, relationship_state, created_reason
  ) values (p_organization_id, p_entity_type, p_entity_id, auth.uid(), 'active', 'existing')
  on conflict (organization_id, entity_type, entity_id, owner_user_id)
  do update set updated_at = now()
  returning id into v_vision_id;

  insert into public.fiche_vision_grants (vision_id, grantee_user_id, granted_by, reason, revoked_at)
  values (v_vision_id, p_to_user_id, auth.uid(), 'manual', null)
  on conflict (vision_id, grantee_user_id)
  do update set revoked_at = null, granted_at = now(), granted_by = auth.uid(), reason = 'manual';

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id,
    visibility, relationship_state, created_reason
  ) values (
    p_organization_id, p_entity_type, p_entity_id, p_to_user_id,
    'restricted', 'relationship_to_build', 'share'
  ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

  return v_vision_id;
end;
$$;

create or replace function public.handover_fiches(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_ids uuid[],
  p_to_user_id uuid,
  p_scope text default 'entity_only',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_entity_id uuid;
  v_contact record;
  v_from_user_id uuid := auth.uid();
  v_current_owner uuid;
  v_sender_vision_id uuid;
  v_entities integer := 0;
  v_people integer := 0;
  v_skipped_people integer := 0;
begin
  if v_from_user_id is null or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if p_entity_type not in ('contact', 'company') or p_scope not in ('entity_only', 'account_and_people') then
    raise exception 'Invalid handover';
  end if;
  if p_entity_type = 'contact' and p_scope <> 'entity_only' then raise exception 'Invalid contact scope'; end if;
  if p_to_user_id = v_from_user_id then raise exception 'Target user already owns this vision'; end if;
  if not exists (
    select 1 from public.memberships member
    where member.organization_id = p_organization_id and member.user_id = p_to_user_id
  ) then raise exception 'Target user is not a member of this organization'; end if;

  foreach v_entity_id in array coalesce(p_entity_ids, '{}'::uuid[]) loop
    if p_entity_type = 'contact' then
      select coalesce(settings.primary_owner_user_id, contact.owner_user_id)
      into v_current_owner
      from public.contacts contact
      left join public.person_settings settings
        on settings.organization_id = contact.organization_id and settings.contact_id = contact.id
      where contact.organization_id = p_organization_id
        and contact.id = v_entity_id
        and contact.merged_into_contact_id is null
      for update of contact;

      if not found then raise exception 'Contact not found'; end if;
      if v_current_owner is not null and v_current_owner <> v_from_user_id then
        raise exception 'Only the current owner can hand over this contact';
      end if;

      insert into public.fiche_visions (
        organization_id, entity_type, entity_id, owner_user_id, relationship_state, created_reason
      ) values (p_organization_id, 'contact', v_entity_id, v_from_user_id, 'active', 'existing')
      on conflict (organization_id, entity_type, entity_id, owner_user_id)
      do update set relationship_state = 'active', updated_at = now()
      returning id into v_sender_vision_id;

      insert into public.fiche_visions (
        organization_id, entity_type, entity_id, owner_user_id,
        visibility, relationship_state, created_reason
      ) values (
        p_organization_id, 'contact', v_entity_id, p_to_user_id,
        'restricted', 'relationship_to_build', 'handover'
      ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

      insert into public.fiche_vision_grants (vision_id, grantee_user_id, granted_by, reason, revoked_at)
      values (v_sender_vision_id, p_to_user_id, v_from_user_id, 'handover', null)
      on conflict (vision_id, grantee_user_id)
      do update set revoked_at = null, granted_at = now(), granted_by = v_from_user_id, reason = 'handover';

      update public.contacts set owner_user_id = p_to_user_id, updated_at = now() where id = v_entity_id;
      insert into public.person_settings (
        organization_id, contact_id, primary_owner_user_id, updated_by, updated_at
      ) values (p_organization_id, v_entity_id, p_to_user_id, v_from_user_id, now())
      on conflict (organization_id, contact_id)
      do update set primary_owner_user_id = excluded.primary_owner_user_id, updated_by = excluded.updated_by, updated_at = now();

      insert into public.fiche_handovers (
        organization_id, entity_type, entity_id, from_user_id, to_user_id, scope, note, transferred_by
      ) values (p_organization_id, 'contact', v_entity_id, v_from_user_id, p_to_user_id, 'entity_only', nullif(btrim(p_note), ''), v_from_user_id);
      insert into public.contact_transfers (
        organization_id, contact_id, from_user_id, to_user_id, kept_copy, transferred_by
      ) values (p_organization_id, v_entity_id, v_from_user_id, p_to_user_id, true, v_from_user_id);
      v_entities := v_entities + 1;
    else
      select settings.primary_owner_user_id
      into v_current_owner
      from public.companies company
      left join public.account_settings settings
        on settings.organization_id = company.organization_id and settings.company_id = company.id
      where company.organization_id = p_organization_id and company.id = v_entity_id
      for update of company;

      if not found then raise exception 'Company not found'; end if;
      if v_current_owner is not null and v_current_owner <> v_from_user_id then
        raise exception 'Only the current owner can hand over this company';
      end if;

      insert into public.fiche_visions (
        organization_id, entity_type, entity_id, owner_user_id, relationship_state, created_reason
      ) values (p_organization_id, 'company', v_entity_id, v_from_user_id, 'active', 'existing')
      on conflict (organization_id, entity_type, entity_id, owner_user_id)
      do update set relationship_state = 'active', updated_at = now()
      returning id into v_sender_vision_id;

      insert into public.fiche_visions (
        organization_id, entity_type, entity_id, owner_user_id,
        visibility, relationship_state, created_reason
      ) values (
        p_organization_id, 'company', v_entity_id, p_to_user_id,
        'restricted', 'relationship_to_build', 'handover'
      ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

      insert into public.fiche_vision_grants (vision_id, grantee_user_id, granted_by, reason, revoked_at)
      values (v_sender_vision_id, p_to_user_id, v_from_user_id, 'handover', null)
      on conflict (vision_id, grantee_user_id)
      do update set revoked_at = null, granted_at = now(), granted_by = v_from_user_id, reason = 'handover';

      insert into public.account_settings (
        organization_id, company_id, primary_owner_user_id, updated_by, updated_at
      ) values (p_organization_id, v_entity_id, p_to_user_id, v_from_user_id, now())
      on conflict (organization_id, company_id)
      do update set primary_owner_user_id = excluded.primary_owner_user_id, updated_by = excluded.updated_by, updated_at = now();

      insert into public.fiche_handovers (
        organization_id, entity_type, entity_id, from_user_id, to_user_id, scope, note, transferred_by
      ) values (p_organization_id, 'company', v_entity_id, v_from_user_id, p_to_user_id, p_scope, nullif(btrim(p_note), ''), v_from_user_id);
      v_entities := v_entities + 1;

      if p_scope = 'account_and_people' then
        for v_contact in
          select contact.id, coalesce(settings.primary_owner_user_id, contact.owner_user_id) as current_owner
          from public.contacts contact
          left join public.person_settings settings
            on settings.organization_id = contact.organization_id and settings.contact_id = contact.id
          where contact.organization_id = p_organization_id
            and contact.company_id = v_entity_id
            and contact.merged_into_contact_id is null
          for update of contact
        loop
          if v_contact.current_owner is not null and v_contact.current_owner <> v_from_user_id then
            v_skipped_people := v_skipped_people + 1;
            continue;
          end if;

          insert into public.fiche_visions (
            organization_id, entity_type, entity_id, owner_user_id, relationship_state, created_reason
          ) values (p_organization_id, 'contact', v_contact.id, v_from_user_id, 'active', 'existing')
          on conflict (organization_id, entity_type, entity_id, owner_user_id)
          do update set relationship_state = 'active', updated_at = now()
          returning id into v_sender_vision_id;

          insert into public.fiche_visions (
            organization_id, entity_type, entity_id, owner_user_id,
            visibility, relationship_state, created_reason
          ) values (
            p_organization_id, 'contact', v_contact.id, p_to_user_id,
            'restricted', 'relationship_to_build', 'handover'
          ) on conflict (organization_id, entity_type, entity_id, owner_user_id) do nothing;

          insert into public.fiche_vision_grants (vision_id, grantee_user_id, granted_by, reason, revoked_at)
          values (v_sender_vision_id, p_to_user_id, v_from_user_id, 'handover', null)
          on conflict (vision_id, grantee_user_id)
          do update set revoked_at = null, granted_at = now(), granted_by = v_from_user_id, reason = 'handover';

          update public.contacts set owner_user_id = p_to_user_id, updated_at = now() where id = v_contact.id;
          insert into public.person_settings (
            organization_id, contact_id, primary_owner_user_id, updated_by, updated_at
          ) values (p_organization_id, v_contact.id, p_to_user_id, v_from_user_id, now())
          on conflict (organization_id, contact_id)
          do update set primary_owner_user_id = excluded.primary_owner_user_id, updated_by = excluded.updated_by, updated_at = now();

          insert into public.fiche_handovers (
            organization_id, entity_type, entity_id, from_user_id, to_user_id, scope, note, transferred_by
          ) values (p_organization_id, 'contact', v_contact.id, v_from_user_id, p_to_user_id, 'entity_only', nullif(btrim(p_note), ''), v_from_user_id);
          insert into public.contact_transfers (
            organization_id, contact_id, from_user_id, to_user_id, kept_copy, transferred_by
          ) values (p_organization_id, v_contact.id, v_from_user_id, p_to_user_id, true, v_from_user_id);
          v_people := v_people + 1;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'entities', v_entities,
    'people', v_people,
    'skipped_people', v_skipped_people,
    'scope', p_scope
  );
end;
$$;

revoke all on table public.fiche_visions, public.fiche_vision_grants, public.fiche_handovers from anon;
grant select, insert, update on public.fiche_visions to authenticated;
grant select on public.fiche_vision_grants, public.fiche_handovers to authenticated;

revoke all on function public.list_fiche_visions(uuid, uuid) from public, anon;
revoke all on function public.list_account_visions(uuid, uuid) from public, anon;
revoke all on function public.set_fiche_vision_visibility(uuid, text, uuid, text) from public, anon;
revoke all on function public.list_fiche_vision_grants(uuid, text, uuid) from public, anon;
revoke all on function public.set_fiche_vision_grant(uuid, text, uuid, uuid, boolean) from public, anon;
revoke all on function public.share_fiche(uuid, text, uuid, uuid, text) from public, anon;
revoke all on function public.handover_fiches(uuid, text, uuid[], uuid, text, text) from public, anon;

grant execute on function public.list_fiche_visions(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_account_visions(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_fiche_vision_visibility(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.list_fiche_vision_grants(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.set_fiche_vision_grant(uuid, text, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.share_fiche(uuid, text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.handover_fiches(uuid, text, uuid[], uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
