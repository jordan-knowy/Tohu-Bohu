insert into public.subscription_plans
  (id, name, description, price_monthly, price_yearly, max_licenses, max_briefs_per_month,
   max_ai_calls_per_month, max_storage_gb, max_profiles_per_month, features, is_active, sort_order, entitlements)
values (
  'tester', 'Testeur', 'Accès testeur — niveau Business, suivi dédié', 0, 0,
  -1, -1, -1, -1, -1,
  '["Accès niveau Business","Toutes les fonctionnalités livrées","Quotas illimités","Suivi testeur"]'::jsonb,
  false, 6,
  jsonb_build_object(
    'calendar_sync', true, 'email_sync', true, 'brief_generation', true, 'human_intelligence', true,
    'company_signals', true, 'behavioral_signals', true, 'account_verdict', true,
    'prioritized_portfolio', true, 'relational_memory', true, 'linkedin_source', true,
    'crm_sync', true, 'team_memory', true, 'analytics', true, 'f11_mobility', true,
    'account_handoff', true, 'sso', true
  )
)
on conflict (id) do update set
  entitlements = excluded.entitlements,
  max_profiles_per_month = excluded.max_profiles_per_month,
  description = excluded.description,
  features = excluded.features;
