-- Console Super Admin : annuaire détaillé, séries temporelles et gestion
-- atomique des accès. Le rôle plateforme reste distinct du plan commercial.

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
      o.name as organization_name
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    order by m.user_id, (m.role = 'owner') desc, m.created_at desc
  ),
  current_subscription as (
    select distinct on (s.organization_id)
      s.organization_id,
      s.plan_id,
      s.status,
      s.billing_cycle,
      s.amount_per_period,
      s.current_period_end
    from public.subscriptions s
    order by s.organization_id, (s.status = 'active') desc, s.updated_at desc
  ),
  user_rows as (
    select
      u.id as user_id,
      u.email,
      coalesce(nullif(p.full_name, ''), split_part(coalesce(u.email, ''), '@', 1), 'Utilisateur Tohu') as full_name,
      p.avatar_url,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      p.onboarding_completed,
      coalesce(p.platform_role, 'user') as platform_role,
      exists (select 1 from public.super_admins sa where sa.user_id = u.id) as is_super_admin,
      w.organization_id,
      w.organization_name,
      w.membership_role,
      coalesce(s.plan_id, 'free') as plan_id,
      coalesce(s.status, 'active') as subscription_status,
      s.billing_cycle,
      coalesce(s.amount_per_period, 0) as amount_per_period,
      s.current_period_end,
      case
        when exists (select 1 from public.super_admins sa where sa.user_id = u.id) then 'super_admin'
        when coalesce(s.plan_id, 'free') = 'tester' then 'test'
        when coalesce(s.plan_id, 'free') = 'free' then 'free'
        else 'paid'
      end as account_type,
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
    'is_active', sp.is_active
  ) order by sp.sort_order, sp.id), '[]'::jsonb)
  into v_plans
  from public.subscription_plans sp;

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
  v_plan_id text;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_user = auth.uid() and access_type <> 'super_admin' then
    raise exception 'Vous ne pouvez pas retirer votre propre accès Super Admin';
  end if;

  if access_type not in ('free', 'paid', 'test', 'super_admin') then
    raise exception 'Type d''accès invalide';
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

  if access_type = 'super_admin' then
    insert into public.super_admins (user_id, email)
    select u.id, lower(u.email) from auth.users u where u.id = target_user
    on conflict (user_id) do update set email = excluded.email;

    update public.profiles
    set platform_role = 'super_admin',
        is_super_admin = true,
        subscription_override = 'super_admin',
        updated_at = now()
    where id = target_user;
    return;
  end if;

  delete from public.super_admins where user_id = target_user;
  update public.profiles
  set platform_role = 'user',
      is_super_admin = false,
      updated_at = now()
  where id = target_user;

  v_plan_id := case
    when access_type = 'free' then 'free'
    when access_type = 'test' then 'tester'
    else coalesce(nullif(paid_plan, ''), 'pro')
  end;

  if access_type = 'paid' and (
    v_plan_id in ('free', 'tester', 'super_admin')
    or not exists (select 1 from public.subscription_plans sp where sp.id = v_plan_id)
  ) then
    raise exception 'Plan payant invalide';
  end if;

  if not exists (select 1 from public.subscription_plans sp where sp.id = v_plan_id) then
    raise exception 'Plan introuvable';
  end if;

  update public.profiles
  set subscription_override = v_plan_id,
      updated_at = now()
  where id = target_user;

  if exists (select 1 from public.subscriptions s where s.organization_id = v_organization_id) then
    update public.subscriptions
    set plan_id = v_plan_id,
        status = 'active',
        amount_per_period = case
          when access_type = 'paid' then coalesce(
            (select sp.price_monthly from public.subscription_plans sp where sp.id = v_plan_id),
            amount_per_period
          )
          else 0
        end,
        canceled_at = null,
        current_period_start = now(),
        current_period_end = now() + interval '1 month',
        updated_at = now()
    where organization_id = v_organization_id;
  else
    insert into public.subscriptions (
      organization_id, plan_id, status, billing_cycle, amount_per_period,
      started_at, current_period_start, current_period_end
    )
    select
      v_organization_id,
      v_plan_id,
      'active',
      'monthly',
      case when access_type = 'paid' then coalesce(sp.price_monthly, 0) else 0 end,
      now(),
      now(),
      now() + interval '1 month'
    from public.subscription_plans sp
    where sp.id = v_plan_id;
  end if;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, text, text) from public, anon;
grant execute on function public.admin_set_user_access(uuid, text, text) to authenticated;
