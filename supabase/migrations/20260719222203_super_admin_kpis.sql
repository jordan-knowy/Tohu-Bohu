-- Vue agrégée du pilotage Tohu. Les données globales ne quittent jamais cette
-- fonction sans une vérification du rôle plateforme côté base.

create or replace function public.get_super_admin_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
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
      'ask_questions', (select count(*) from public.user_behavior_events where event_type in ('ask_question', 'ask_tohu')),
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
$$;

revoke execute on function public.get_super_admin_kpis() from public, anon;
grant execute on function public.get_super_admin_kpis() to authenticated;
