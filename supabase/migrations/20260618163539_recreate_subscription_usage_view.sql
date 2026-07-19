drop view if exists public.subscription_usage;

create view public.subscription_usage as
select
  s.organization_id,
  s.plan_id,
  s.status,
  s.current_period_start,
  s.current_period_end,
  sp.max_licenses,
  sp.max_briefs_per_month,
  sp.max_ai_calls_per_month,
  sp.max_storage_gb,
  sp.price_monthly,
  sp.max_profiles_per_month,
  sp.entitlements,
  ( select count(distinct m.user_id) from public.memberships m
      where m.organization_id = s.organization_id ) as licenses_used,
  ( select count(*) from public.meetings mt
      where mt.organization_id = s.organization_id
        and mt.brief_status = any (array['ready','consulted'])
        and mt.created_at >= s.current_period_start ) as briefs_used,
  ( select count(*) from public.ai_usage_events ae
      where ae.organization_id = s.organization_id
        and ae.created_at >= s.current_period_start ) as ai_calls_used,
  ( select count(*) from public.contacts c
      where c.organization_id = s.organization_id
        and c.merged_into_contact_id is null
        and c.created_at >= s.current_period_start ) as profiles_used
from public.subscriptions s
join public.subscription_plans sp on sp.id = s.plan_id
where s.status = 'active';
