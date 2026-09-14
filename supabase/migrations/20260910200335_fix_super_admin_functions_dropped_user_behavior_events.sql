-- user_behavior_events a été supprimée (drop_unused_tables, appliquée hors
-- suivi de migration) mais get_super_admin_kpis()/get_super_admin_console()
-- la référencent encore, ce qui casse tout le chargement du mode Super Admin
-- (l'authentification passe, mais getSuperAdminData() lève une erreur SQL).

create or replace function public.get_super_admin_kpis()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  total_users numeric;
  total_workspaces numeric;
  active_paid_workspaces numeric;
  total_memberships numeric;
  total_companies numeric;
  total_contacts numeric;
  mrr_cents numeric;
  sync_total_24h numeric;
  sync_success_24h numeric;
  subscriptions_by_plan jsonb;
  revenue_by_plan jsonb;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into total_users
  from auth.users
  where deleted_at is null;

  select count(*) into total_workspaces from public.organizations;
  select count(*) into total_memberships from public.memberships;
  select count(*) into total_companies from public.companies;
  select count(*) into total_contacts from public.contacts where merged_into_contact_id is null;

  select count(distinct organization_id) into active_paid_workspaces
  from public.subscriptions
  where status in ('active', 'trialing')
    and plan_id <> 'free'
    and amount_per_period > 0;

  select coalesce(sum(
    case
      when billing_cycle = 'yearly' then amount_per_period::numeric / 12
      else amount_per_period::numeric
    end
  ), 0) into mrr_cents
  from public.subscriptions
  where status = 'active'
    and plan_id <> 'free'
    and amount_per_period > 0;

  select coalesce(jsonb_object_agg(plan_id, total), '{}'::jsonb)
  into subscriptions_by_plan
  from (
    select plan_id, count(*) as total
    from public.subscriptions
    group by plan_id
  ) plans;

  select coalesce(jsonb_object_agg(plan_id, monthly_revenue), '{}'::jsonb)
  into revenue_by_plan
  from (
    select
      plan_id,
      round(sum(case when billing_cycle = 'yearly' then amount_per_period::numeric / 12 else amount_per_period::numeric end), 2) as monthly_revenue
    from public.subscriptions
    where status = 'active' and amount_per_period > 0
    group by plan_id
  ) revenue;

  select count(*), count(*) filter (where status in ('succeeded', 'success', 'completed'))
  into sync_total_24h, sync_success_24h
  from public.sync_jobs
  where created_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', total_users,
      'new_30d', (select count(*) from auth.users where deleted_at is null and created_at >= now() - interval '30 days'),
      'daily_active', (select count(*) from auth.users where deleted_at is null and last_sign_in_at >= now() - interval '1 day'),
      'weekly_active', (select count(*) from auth.users where deleted_at is null and last_sign_in_at >= now() - interval '7 days'),
      'monthly_active', (select count(*) from auth.users where deleted_at is null and last_sign_in_at >= now() - interval '30 days'),
      'inactive_30d', (select count(*) from auth.users where deleted_at is null and (last_sign_in_at is null or last_sign_in_at < now() - interval '30 days')),
      'deleted', (select count(*) from auth.users where deleted_at is not null),
      'onboarded', (select count(*) from public.profiles where onboarding_completed),
      'onboarding_rate', case when total_users > 0 then round(100 * (select count(*) from public.profiles where onboarding_completed)::numeric / total_users, 1) else 0 end,
      'paying', (select count(distinct m.user_id) from public.memberships m join public.subscriptions s on s.organization_id = m.organization_id where s.status = 'active' and s.plan_id <> 'free' and s.amount_per_period > 0),
      'beta', null,
      'super_admins', (select count(*) from public.super_admins),
      'free_to_paid_conversion', null,
      'beta_to_paid_conversion', null
    ),
    'workspaces', jsonb_build_object(
      'total', total_workspaces,
      'active', (select count(distinct organization_id) from public.memberships),
      'new_30d', (select count(*) from public.organizations where created_at >= now() - interval '30 days'),
      'trialing', (select count(distinct organization_id) from public.subscriptions where status = 'trialing'),
      'beta', null,
      'canceled', (select count(distinct organization_id) from public.subscriptions where status = 'canceled'),
      'past_due', (select count(distinct organization_id) from public.subscriptions where status = 'past_due'),
      'avg_members', case when total_workspaces > 0 then round(total_memberships / total_workspaces, 1) else 0 end,
      'avg_companies', case when total_workspaces > 0 then round(total_companies / total_workspaces, 1) else 0 end,
      'avg_contacts', case when total_workspaces > 0 then round(total_contacts / total_workspaces, 1) else 0 end
    ),
    'subscriptions', jsonb_build_object(
      'free', coalesce((subscriptions_by_plan->>'free')::numeric, 0),
      'solo', coalesce((subscriptions_by_plan->>'solo')::numeric, 0),
      'pro', coalesce((subscriptions_by_plan->>'pro')::numeric, 0),
      'business', coalesce((subscriptions_by_plan->>'business')::numeric, 0),
      'beta_business', null,
      'active', (select count(*) from public.subscriptions where status = 'active'),
      'trialing', (select count(*) from public.subscriptions where status = 'trialing'),
      'canceled', (select count(*) from public.subscriptions where status = 'canceled'),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'upgrades', null,
      'downgrades', null,
      'reactivations', null,
      'by_plan', subscriptions_by_plan
    ),
    'finance', jsonb_build_object(
      'mrr_cents', round(mrr_cents, 2),
      'arr_cents', round(mrr_cents * 12, 2),
      'average_revenue_per_workspace_cents', case when active_paid_workspaces > 0 then round(mrr_cents / active_paid_workspaces, 2) else 0 end,
      'average_revenue_per_seat_cents', case when total_memberships > 0 then round(mrr_cents / total_memberships, 2) else 0 end,
      'monthly_churn_rate', null,
      'annual_churn_rate', null,
      'refunds_cents', null,
      'pending_payments_cents', null,
      'paid_invoices', null,
      'open_invoices', null,
      'credits_cents', null,
      'taxes_cents', null,
      'revenue_by_plan_cents', revenue_by_plan
    ),
    'costs', jsonb_build_object(
      'ai_cents', null,
      'openrouter_cents', null,
      'supabase_cents', null,
      'storage_cents', null,
      'transcription_cents', null,
      'emailing_cents', null,
      'cost_per_user_cents', null,
      'gross_margin_rate', null
    ),
    'product', jsonb_build_object(
      'briefs', (select count(*) from public.briefs),
      'ask_questions', null,
      'transcripts', null,
      'contacts', total_contacts,
      'companies', total_companies,
      'signals', (select (select count(*) from public.company_signals) + (select count(*) from public.behavioral_signals)),
      'recommendations', (select (select count(*) from public.account_recommendations) + (select count(*) from public.person_recommendations)),
      'connected_connectors', (select count(*) from public.connectors where status = 'connected'),
      'ai_calls_30d', (select count(*) from public.ai_usage_events where created_at >= now() - interval '30 days'),
      'ai_tokens_30d', (select coalesce(sum(tokens_used), 0) from public.ai_usage_events where created_at >= now() - interval '30 days'),
      'home_adoption_rate', case when total_users > 0 then round(100 * (select count(*) from public.profiles where last_home_seen_at is not null)::numeric / total_users, 1) else 0 end,
      'record_adoption_rate', null
    ),
    'operations', jsonb_build_object(
      'sync_jobs_24h', sync_total_24h,
      'sync_succeeded_24h', sync_success_24h,
      'sync_failed_24h', sync_total_24h - sync_success_24h,
      'sync_success_rate_24h', case when sync_total_24h > 0 then round(100 * sync_success_24h / sync_total_24h, 1) else 100 end,
      'connector_errors', (select count(*) from public.connectors where status in ('error', 'expired', 'needs_reauth', 'revoked')),
      'average_sync_seconds', (select round(avg(extract(epoch from (completed_at - started_at)))::numeric, 1) from public.sync_jobs where started_at is not null and completed_at is not null),
      'edge_function_errors_24h', null,
      'openrouter_errors_24h', null,
      'api_calls_24h', null,
      'quota_overruns_30d', null,
      'storage_bytes', null,
      'incident_affected_users', null
    )
  );
end;
$function$;

create or replace function public.get_super_admin_console()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
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
      s.seat_quantity,
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
      coalesce(s.seat_quantity, 1) as seat_quantity,
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
$function$;

notify pgrst, 'reload schema';
