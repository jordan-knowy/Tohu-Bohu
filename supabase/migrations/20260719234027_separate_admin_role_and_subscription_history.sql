-- Le rôle plateforme Super Admin et l'abonnement commercial sont deux axes
-- indépendants. Cette migration ajoute un historique durable des changements
-- d'abonnement et remplace les RPC de la console par ce contrat explicite.

create table if not exists public.subscription_change_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  previous_plan_id text references public.subscription_plans(id),
  new_plan_id text not null references public.subscription_plans(id),
  previous_status text,
  new_status text not null,
  previous_billing_cycle text,
  new_billing_cycle text,
  previous_amount_per_period integer,
  new_amount_per_period integer,
  change_source text not null default 'system',
  changed_by uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists subscription_change_history_org_date_idx
  on public.subscription_change_history (organization_id, changed_at desc);
create index if not exists subscription_change_history_user_date_idx
  on public.subscription_change_history (target_user_id, changed_at desc);

alter table public.subscription_change_history enable row level security;
revoke all on table public.subscription_change_history from public, anon, authenticated;
grant all on table public.subscription_change_history to service_role;

create or replace function public.record_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_by uuid;
  v_target_user uuid;
  v_source text;
  v_reason text;
begin
  if tg_op = 'UPDATE'
    and old.plan_id is not distinct from new.plan_id
    and old.status is not distinct from new.status
    and old.billing_cycle is not distinct from new.billing_cycle
    and old.amount_per_period is not distinct from new.amount_per_period
  then
    return new;
  end if;

  begin
    v_changed_by := nullif(current_setting('app.subscription_changed_by', true), '')::uuid;
  exception when invalid_text_representation then
    v_changed_by := null;
  end;

  begin
    v_target_user := nullif(current_setting('app.subscription_target_user', true), '')::uuid;
  exception when invalid_text_representation then
    v_target_user := null;
  end;

  v_source := coalesce(
    nullif(current_setting('app.subscription_change_source', true), ''),
    case when new.stripe_subscription_id is not null then 'stripe' else 'system' end
  );
  v_reason := nullif(current_setting('app.subscription_change_reason', true), '');

  insert into public.subscription_change_history (
    organization_id,
    subscription_id,
    target_user_id,
    previous_plan_id,
    new_plan_id,
    previous_status,
    new_status,
    previous_billing_cycle,
    new_billing_cycle,
    previous_amount_per_period,
    new_amount_per_period,
    change_source,
    changed_by,
    reason
  ) values (
    new.organization_id,
    new.id,
    v_target_user,
    case when tg_op = 'UPDATE' then old.plan_id else null end,
    new.plan_id,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    case when tg_op = 'UPDATE' then old.billing_cycle else null end,
    new.billing_cycle,
    case when tg_op = 'UPDATE' then old.amount_per_period else null end,
    new.amount_per_period,
    v_source,
    v_changed_by,
    v_reason
  );

  return new;
end;
$$;

drop trigger if exists subscriptions_record_change on public.subscriptions;
create trigger subscriptions_record_change
after insert or update of plan_id, status, billing_cycle, amount_per_period
on public.subscriptions
for each row execute function public.record_subscription_change();

-- Point de départ de la chronologie pour les abonnements déjà présents.
insert into public.subscription_change_history (
  organization_id,
  subscription_id,
  previous_plan_id,
  new_plan_id,
  previous_status,
  new_status,
  previous_billing_cycle,
  new_billing_cycle,
  previous_amount_per_period,
  new_amount_per_period,
  change_source,
  reason,
  changed_at
)
select
  s.organization_id,
  s.id,
  null,
  s.plan_id,
  null,
  s.status,
  null,
  s.billing_cycle,
  null,
  s.amount_per_period,
  'migration_snapshot',
  'État initial importé lors de la création de la chronologie',
  coalesce(s.started_at, s.created_at, now())
from public.subscriptions s
where not exists (
  select 1
  from public.subscription_change_history h
  where h.subscription_id = s.id
);

-- Le plan historique "super_admin" devient un accès Test : les droits restent
-- larges, mais le rôle plateforme n'est plus présenté comme un abonnement.
select set_config('app.subscription_change_source', 'migration_cleanup', true);
select set_config('app.subscription_change_reason', 'Séparation du rôle Super Admin et de l’abonnement commercial', true);

update public.subscriptions
set
  plan_id = 'tester',
  amount_per_period = 0,
  updated_at = now()
where plan_id = 'super_admin';

update public.subscription_plans
set is_active = false
where id = 'super_admin';

update public.profiles p
set
  subscription_override = coalesce((
    select s.plan_id
    from public.memberships m
    join public.subscriptions s on s.organization_id = m.organization_id
    where m.user_id = p.id
    order by (m.role = 'owner') desc, s.updated_at desc
    limit 1
  ), 'tester'),
  updated_at = now()
where p.subscription_override = 'super_admin';

create or replace function public.get_super_admin_console()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_users jsonb;
  v_timeseries jsonb;
  v_plans jsonb;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with primary_workspace as (
    select distinct on (m.user_id)
      m.user_id,
      m.organization_id,
      m.role as membership_role,
      m.created_at as membership_created_at,
      o.name as organization_name
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    order by m.user_id, (m.role = 'owner') desc, m.created_at desc
  ),
  current_subscription as (
    select distinct on (s.organization_id)
      s.id as subscription_id,
      s.organization_id,
      s.plan_id,
      s.status,
      s.billing_cycle,
      s.amount_per_period,
      s.started_at,
      s.current_period_start,
      s.current_period_end,
      s.created_at as subscription_created_at,
      s.updated_at as subscription_updated_at,
      (s.stripe_subscription_id is not null) as stripe_managed
    from public.subscriptions s
    order by
      s.organization_id,
      (s.status in ('active', 'trialing', 'past_due')) desc,
      s.updated_at desc
  ),
  user_rows as (
    select
      u.id as user_id,
      u.email,
      coalesce(nullif(p.full_name, ''), split_part(coalesce(u.email, ''), '@', 1), 'Utilisateur Tohu') as full_name,
      p.avatar_url,
      u.created_at,
      u.created_at as customer_since,
      u.last_sign_in_at,
      u.email_confirmed_at,
      p.onboarding_completed,
      coalesce(p.platform_role, 'user') as platform_role,
      exists (select 1 from public.super_admins sa where sa.user_id = u.id) as is_super_admin,
      w.organization_id,
      w.organization_name,
      w.membership_role,
      w.membership_created_at,
      s.subscription_id,
      coalesce(s.plan_id, 'free') as plan_id,
      coalesce(sp.name, initcap(coalesce(s.plan_id, 'free'))) as plan_name,
      coalesce(s.status, 'active') as subscription_status,
      s.billing_cycle,
      coalesce(s.amount_per_period, 0) as amount_per_period,
      s.started_at as subscription_started_at,
      s.current_period_start,
      s.current_period_end,
      s.subscription_created_at,
      s.subscription_updated_at,
      coalesce(s.stripe_managed, false) as stripe_managed,
      case
        when coalesce(s.plan_id, 'free') = 'tester' then 'test'
        when coalesce(s.plan_id, 'free') = 'free' then 'free'
        else 'paid'
      end as account_type,
      (
        select max(h.changed_at)
        from public.subscription_change_history h
        where h.organization_id = w.organization_id
      ) as plan_changed_at,
      coalesce((
        select jsonb_agg(to_jsonb(history_row) order by history_row.changed_at desc)
        from (
          select
            h.id,
            h.previous_plan_id,
            previous_plan.name as previous_plan_name,
            h.new_plan_id,
            new_plan.name as new_plan_name,
            h.previous_status,
            h.new_status,
            h.previous_billing_cycle,
            h.new_billing_cycle,
            h.previous_amount_per_period,
            h.new_amount_per_period,
            h.change_source,
            h.reason,
            h.changed_at,
            h.changed_by,
            coalesce(nullif(actor_profile.full_name, ''), split_part(actor.email, '@', 1)) as changed_by_name
          from public.subscription_change_history h
          left join public.subscription_plans previous_plan on previous_plan.id = h.previous_plan_id
          join public.subscription_plans new_plan on new_plan.id = h.new_plan_id
          left join auth.users actor on actor.id = h.changed_by
          left join public.profiles actor_profile on actor_profile.id = h.changed_by
          where h.organization_id = w.organization_id
          order by h.changed_at desc
          limit 50
        ) history_row
      ), '[]'::jsonb) as plan_history,
      (select count(*) from public.companies c where c.organization_id = w.organization_id) as companies_count,
      (select count(*) from public.contacts c where c.organization_id = w.organization_id and c.owner_user_id = u.id and c.merged_into_contact_id is null) as contacts_count,
      (select count(*) from public.meetings m where m.owner_user_id = u.id) as meetings_count,
      (select count(*) from public.briefs b join public.meetings m on m.id = b.meeting_id where m.owner_user_id = u.id) as briefs_count,
      (select count(*) from public.communication_messages cm join public.contacts c on c.id = cm.contact_id where c.owner_user_id = u.id) as messages_count,
      (select count(*) from public.connectors c where c.user_id = u.id and c.status = 'connected') as connectors_count,
      (select count(*) from public.ai_usage_events a where a.user_id = u.id) as ai_calls_count,
      (select coalesce(sum(a.tokens_used), 0) from public.ai_usage_events a where a.user_id = u.id) as ai_tokens_count,
      (select count(*) from public.sync_jobs j where j.user_id = u.id) as sync_jobs_count,
      (select count(*) from public.sync_jobs j where j.user_id = u.id and j.status = 'failed') as sync_failures_count,
      greatest(
        u.last_sign_in_at,
        (select max(e.created_at) from public.user_behavior_events e where e.user_id = u.id),
        (select max(a.created_at) from public.ai_usage_events a where a.user_id = u.id),
        (select max(j.created_at) from public.sync_jobs j where j.user_id = u.id)
      ) as last_activity_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join primary_workspace w on w.user_id = u.id
    left join current_subscription s on s.organization_id = w.organization_id
    left join public.subscription_plans sp on sp.id = s.plan_id
    where u.deleted_at is null
  )
  select coalesce(jsonb_agg(to_jsonb(user_rows) order by created_at desc), '[]'::jsonb)
  into v_users
  from user_rows;

  with days as (
    select generate_series(current_date - 29, current_date, interval '1 day')::date as day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d.day,
    'signups', (select count(*) from auth.users u where u.deleted_at is null and u.created_at::date = d.day),
    'active_users', (
      select count(distinct activity.user_id)
      from (
        select e.user_id from public.user_behavior_events e where e.created_at::date = d.day
        union
        select a.user_id from public.ai_usage_events a where a.created_at::date = d.day
        union
        select j.user_id from public.sync_jobs j where j.created_at::date = d.day and j.user_id is not null
      ) activity
    ),
    'ai_calls', (select count(*) from public.ai_usage_events a where a.created_at::date = d.day),
    'sync_succeeded', (select count(*) from public.sync_jobs j where j.created_at::date = d.day and j.status = 'succeeded'),
    'sync_failed', (select count(*) from public.sync_jobs j where j.created_at::date = d.day and j.status = 'failed')
  ) order by d.day), '[]'::jsonb)
  into v_timeseries
  from days d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sp.id,
    'name', sp.name,
    'price_monthly', sp.price_monthly,
    'price_yearly', sp.price_yearly,
    'is_active', sp.is_active
  ) order by sp.sort_order, sp.id), '[]'::jsonb)
  into v_plans
  from public.subscription_plans sp
  where sp.id in ('free', 'tester', 'solo', 'pro', 'business');

  return jsonb_build_object(
    'generated_at', now(),
    'users', v_users,
    'timeseries', v_timeseries,
    'plans', v_plans
  );
end;
$$;

revoke execute on function public.get_super_admin_console() from public, anon;
grant execute on function public.get_super_admin_console() to authenticated;

create or replace function public.admin_set_user_access(
  target_user uuid,
  access_type text,
  paid_plan text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organization_id uuid;
  v_subscription_id uuid;
  v_plan_id text;
  v_amount integer;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if access_type not in ('free', 'paid', 'test') then
    raise exception 'Type d''abonnement invalide';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user and u.deleted_at is null) then
    raise exception 'Utilisateur introuvable';
  end if;

  select m.organization_id
  into v_organization_id
  from public.memberships m
  where m.user_id = target_user
  order by (m.role = 'owner') desc, m.created_at desc
  limit 1;

  if v_organization_id is null then
    raise exception 'Aucun workspace associé à cet utilisateur';
  end if;

  v_plan_id := case
    when access_type = 'free' then 'free'
    when access_type = 'test' then 'tester'
    else lower(coalesce(nullif(paid_plan, ''), 'pro'))
  end;

  if access_type = 'paid' and v_plan_id not in ('solo', 'pro', 'business') then
    raise exception 'Le plan payant doit être Solo, Pro ou Business';
  end if;

  select sp.price_monthly
  into v_amount
  from public.subscription_plans sp
  where sp.id = v_plan_id
    and (sp.is_active or sp.id = 'tester');

  if not found then
    raise exception 'Plan introuvable ou inactif';
  end if;

  perform set_config('app.subscription_changed_by', auth.uid()::text, true);
  perform set_config('app.subscription_target_user', target_user::text, true);
  perform set_config('app.subscription_change_source', 'super_admin', true);
  perform set_config('app.subscription_change_reason', 'Abonnement programmé depuis la console Super Admin', true);

  select s.id
  into v_subscription_id
  from public.subscriptions s
  where s.organization_id = v_organization_id
  order by
    (s.status in ('active', 'trialing', 'past_due')) desc,
    s.updated_at desc
  limit 1;

  if v_subscription_id is null then
    insert into public.subscriptions (
      organization_id,
      plan_id,
      status,
      billing_cycle,
      amount_per_period,
      started_at,
      current_period_start,
      current_period_end
    ) values (
      v_organization_id,
      v_plan_id,
      'active',
      'monthly',
      case when access_type = 'paid' then coalesce(v_amount, 0) else 0 end,
      now(),
      now(),
      now() + interval '1 month'
    );
  else
    update public.subscriptions
    set
      plan_id = v_plan_id,
      status = 'active',
      billing_cycle = 'monthly',
      amount_per_period = case when access_type = 'paid' then coalesce(v_amount, 0) else 0 end,
      canceled_at = null,
      current_period_start = case
        when plan_id is distinct from v_plan_id then now()
        else current_period_start
      end,
      current_period_end = case
        when plan_id is distinct from v_plan_id then now() + interval '1 month'
        else current_period_end
      end,
      updated_at = now()
    where id = v_subscription_id
      and (
        plan_id is distinct from v_plan_id
        or status is distinct from 'active'
        or billing_cycle is distinct from 'monthly'
        or amount_per_period is distinct from case when access_type = 'paid' then coalesce(v_amount, 0) else 0 end
      );
  end if;

  update public.profiles
  set
    subscription_override = v_plan_id,
    updated_at = now()
  where id = target_user;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    target_table,
    target_id,
    metadata
  ) values (
    v_organization_id,
    auth.uid(),
    'admin_subscription_programmed',
    'profiles',
    target_user,
    jsonb_build_object(
      'access_type', access_type,
      'plan_id', v_plan_id,
      'subscription_id', v_subscription_id
    )
  );
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, text, text) from public, anon;
grant execute on function public.admin_set_user_access(uuid, text, text) to authenticated;

create or replace function public.admin_set_super_admin(target_user uuid, make_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_was_admin boolean;
  v_organization_id uuid;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user and u.deleted_at is null) then
    raise exception 'Utilisateur introuvable';
  end if;

  if target_user = auth.uid() and not make_admin then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle Super Admin';
  end if;

  select exists (
    select 1 from public.super_admins sa where sa.user_id = target_user
  ) into v_was_admin;

  if v_was_admin = make_admin then
    return;
  end if;

  if make_admin then
    insert into public.super_admins (user_id, email)
    select u.id, lower(u.email)
    from auth.users u
    where u.id = target_user
    on conflict (user_id) do update set email = excluded.email;

    update public.profiles
    set platform_role = 'super_admin', is_super_admin = true, updated_at = now()
    where id = target_user;
  else
    delete from public.super_admins where user_id = target_user;

    update public.profiles
    set platform_role = 'user', is_super_admin = false, updated_at = now()
    where id = target_user;
  end if;

  select m.organization_id
  into v_organization_id
  from public.memberships m
  where m.user_id = target_user
  order by (m.role = 'owner') desc, m.created_at desc
  limit 1;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    target_table,
    target_id,
    metadata
  ) values (
    v_organization_id,
    auth.uid(),
    'admin_platform_role_changed',
    'profiles',
    target_user,
    jsonb_build_object(
      'previous_role', case when v_was_admin then 'super_admin' else 'user' end,
      'new_role', case when make_admin then 'super_admin' else 'user' end
    )
  );
end;
$$;

revoke execute on function public.admin_set_super_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_super_admin(uuid, boolean) to authenticated;

comment on table public.subscription_change_history is
  'Chronologie immuable des changements de plan/statut d’un workspace, indépendante des rôles plateforme.';
