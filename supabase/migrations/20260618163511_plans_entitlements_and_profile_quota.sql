-- Plans : flags machine (entitlements) + quota "profils intégrables/mois" + prix/quotas alignés maquette
alter table public.subscription_plans
  add column if not exists entitlements jsonb not null default '{}'::jsonb,
  add column if not exists max_profiles_per_month integer;

-- FREE — 0€, 5 profils/mois, briefs illimités, calendrier + mail + brief + intelligence basique
update public.subscription_plans set
  price_monthly = 0, price_yearly = 0,
  max_licenses = 1, max_profiles_per_month = 5, max_briefs_per_month = -1,
  entitlements = jsonb_build_object(
    'calendar_sync', true, 'email_sync', true, 'brief_generation', true, 'human_intelligence', true,
    'company_signals', false, 'behavioral_signals', false, 'account_verdict', false,
    'prioritized_portfolio', false, 'relational_memory', false, 'linkedin_source', false,
    'crm_sync', false, 'team_memory', false, 'analytics', false, 'f11_mobility', false,
    'account_handoff', false, 'sso', false
  )
where id = 'free';

-- PRO — 69€/mois, 20 profils/mois, boucle Prepare→Remember complète
update public.subscription_plans set
  price_monthly = 6900, price_yearly = 5900,
  max_licenses = 1, max_profiles_per_month = 20, max_briefs_per_month = -1,
  entitlements = jsonb_build_object(
    'calendar_sync', true, 'email_sync', true, 'brief_generation', true, 'human_intelligence', true,
    'company_signals', true, 'behavioral_signals', true, 'account_verdict', true,
    'prioritized_portfolio', true, 'relational_memory', true, 'linkedin_source', true,
    'crm_sync', true, 'team_memory', false, 'analytics', false, 'f11_mobility', false,
    'account_handoff', false, 'sso', false
  )
where id = 'pro';

-- BUSINESS — 89€/siège/mois, 50 profils/siège/mois, tout Pro + intelligence de compte
update public.subscription_plans set
  price_monthly = 8900, price_yearly = 7500,
  max_licenses = 100, max_profiles_per_month = 50, max_briefs_per_month = -1,
  entitlements = jsonb_build_object(
    'calendar_sync', true, 'email_sync', true, 'brief_generation', true, 'human_intelligence', true,
    'company_signals', true, 'behavioral_signals', true, 'account_verdict', true,
    'prioritized_portfolio', true, 'relational_memory', true, 'linkedin_source', true,
    'crm_sync', true, 'team_memory', true, 'analytics', true, 'f11_mobility', true,
    'account_handoff', true, 'sso', true
  )
where id = 'business';

-- ENTERPRISE & SUPER_ADMIN — tout activé (illimité)
update public.subscription_plans set
  max_profiles_per_month = -1,
  entitlements = jsonb_build_object(
    'calendar_sync', true, 'email_sync', true, 'brief_generation', true, 'human_intelligence', true,
    'company_signals', true, 'behavioral_signals', true, 'account_verdict', true,
    'prioritized_portfolio', true, 'relational_memory', true, 'linkedin_source', true,
    'crm_sync', true, 'team_memory', true, 'analytics', true, 'f11_mobility', true,
    'account_handoff', true, 'sso', true
  )
where id in ('enterprise', 'super_admin');
