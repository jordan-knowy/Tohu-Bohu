-- Demandes de suppression : aucune donnée n'est supprimée automatiquement.
-- L'utilisateur dépose un dossier, puis l'équipe technique le traite depuis
-- la console Super Admin avec une trace d'audit à chaque changement.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  primary_reason text not null check (primary_reason in (
    'not_useful', 'too_expensive', 'missing_features', 'technical_issues', 'privacy', 'other'
  )),
  retention_factor text not null check (retention_factor in (
    'better_price', 'better_reliability', 'more_features', 'more_support', 'temporary_pause', 'nothing', 'other'
  )),
  deletion_scope text not null check (deletion_scope in (
    'account_and_data', 'workspace_and_data', 'product_data_only', 'not_sure', 'other'
  )),
  details text not null check (char_length(trim(details)) >= 20),
  status text not null default 'pending' check (status in (
    'pending', 'reviewing', 'confirmed', 'completed', 'rejected', 'cancelled'
  )),
  assigned_to uuid references auth.users(id) on delete set null,
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_requests_one_active_per_user
  on public.account_deletion_requests (user_id)
  where status in ('pending', 'reviewing', 'confirmed');

create index if not exists account_deletion_requests_status_requested_idx
  on public.account_deletion_requests (status, requested_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists account_deletion_requests_read_own on public.account_deletion_requests;
create policy account_deletion_requests_read_own
  on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;

create or replace function public.submit_account_deletion_request(
  p_organization_id uuid,
  p_primary_reason text,
  p_retention_factor text,
  p_deletion_scope text,
  p_details text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_organization_id is not null and not private.is_org_member(p_organization_id) then
    raise exception 'not authorized';
  end if;
  if p_primary_reason not in ('not_useful', 'too_expensive', 'missing_features', 'technical_issues', 'privacy', 'other') then
    raise exception 'invalid primary reason';
  end if;
  if p_retention_factor not in ('better_price', 'better_reliability', 'more_features', 'more_support', 'temporary_pause', 'nothing', 'other') then
    raise exception 'invalid retention factor';
  end if;
  if p_deletion_scope not in ('account_and_data', 'workspace_and_data', 'product_data_only', 'not_sure', 'other') then
    raise exception 'invalid deletion scope';
  end if;
  if char_length(trim(coalesce(p_details, ''))) < 20 then
    raise exception 'details must contain at least 20 characters';
  end if;
  if exists (
    select 1 from public.account_deletion_requests
    where user_id = auth.uid() and status in ('pending', 'reviewing', 'confirmed')
  ) then
    raise exception 'an active deletion request already exists';
  end if;

  insert into public.account_deletion_requests (
    user_id, organization_id, primary_reason, retention_factor, deletion_scope, details
  ) values (
    auth.uid(), p_organization_id, p_primary_reason, p_retention_factor, p_deletion_scope, trim(p_details)
  )
  returning id into v_request_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, target_table, target_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'account_deletion_requested',
    'account_deletion_requests', v_request_id,
    jsonb_build_object('status', 'pending')
  );

  return v_request_id;
end;
$$;

create or replace function public.get_my_account_deletion_request()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'requested_at', r.requested_at,
      'reviewed_at', r.reviewed_at,
      'completed_at', r.completed_at
    )
    from public.account_deletion_requests r
    where r.user_id = auth.uid()
    order by r.requested_at desc
    limit 1
  ), 'null'::jsonb);
$$;

create or replace function public.admin_list_account_deletion_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'not authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'user_id', r.user_id,
      'email', u.email,
      'full_name', coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)),
      'organization_id', r.organization_id,
      'organization_name', o.name,
      'primary_reason', r.primary_reason,
      'retention_factor', r.retention_factor,
      'deletion_scope', r.deletion_scope,
      'details', r.details,
      'status', r.status,
      'admin_note', r.admin_note,
      'assigned_to', r.assigned_to,
      'requested_at', r.requested_at,
      'reviewed_at', r.reviewed_at,
      'completed_at', r.completed_at,
      'updated_at', r.updated_at
    ) order by
      case r.status when 'pending' then 1 when 'reviewing' then 2 when 'confirmed' then 3 else 4 end,
      r.requested_at desc)
    from public.account_deletion_requests r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = r.user_id
    left join public.organizations o on o.id = r.organization_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_update_account_deletion_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.account_deletion_requests%rowtype;
begin
  if not public.is_super_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('pending', 'reviewing', 'confirmed', 'completed', 'rejected') then
    raise exception 'invalid status';
  end if;

  select * into v_request from public.account_deletion_requests where id = p_request_id;
  if v_request.id is null then raise exception 'request not found'; end if;

  update public.account_deletion_requests
  set
    status = p_status,
    admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
    assigned_to = case when p_status in ('reviewing', 'confirmed', 'completed', 'rejected') then auth.uid() else assigned_to end,
    reviewed_at = case when p_status in ('reviewing', 'confirmed', 'rejected') then coalesce(reviewed_at, now()) else reviewed_at end,
    completed_at = case when p_status = 'completed' then now() else null end,
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, target_table, target_id, metadata
  ) values (
    v_request.organization_id, auth.uid(), 'account_deletion_request_status_changed',
    'account_deletion_requests', p_request_id,
    jsonb_build_object('from', v_request.status, 'to', p_status, 'admin_note', nullif(trim(coalesce(p_admin_note, '')), ''))
  );
end;
$$;

revoke all on function public.submit_account_deletion_request(uuid, text, text, text, text) from public, anon;
revoke all on function public.get_my_account_deletion_request() from public, anon;
revoke all on function public.admin_list_account_deletion_requests() from public, anon;
revoke all on function public.admin_update_account_deletion_request(uuid, text, text) from public, anon;

grant execute on function public.submit_account_deletion_request(uuid, text, text, text, text) to authenticated;
grant execute on function public.get_my_account_deletion_request() to authenticated;
grant execute on function public.admin_list_account_deletion_requests() to authenticated;
grant execute on function public.admin_update_account_deletion_request(uuid, text, text) to authenticated;
