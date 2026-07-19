import { getSupabase } from '../lib/supabase'

export type SuperAdminKpis = {
  generated_at: string
  users: Record<string, number | null>
  workspaces: Record<string, number | null>
  subscriptions: Record<string, number | null> & { by_plan?: Record<string, number> }
  finance: Record<string, number | null> & { revenue_by_plan_cents?: Record<string, number> }
  product: Record<string, number | null>
  operations: Record<string, number | null>
  costs: Record<string, number | null>
}

export type SuperAdminUser = {
  user_id: string
  email: string | null
  full_name: string
  avatar_url: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  last_activity_at: string | null
  onboarding_completed: boolean
  platform_role: string
  is_super_admin: boolean
  organization_id: string | null
  organization_name: string | null
  membership_role: string | null
  plan_id: string
  subscription_status: string
  billing_cycle: string | null
  amount_per_period: number
  current_period_end: string | null
  account_type: 'free' | 'paid' | 'test' | 'super_admin'
  companies_count: number
  contacts_count: number
  meetings_count: number
  briefs_count: number
  messages_count: number
  connectors_count: number
  ai_calls_count: number
  ai_tokens_count: number
  sync_jobs_count: number
  sync_failures_count: number
}

export type SuperAdminTimeseriesPoint = {
  date: string
  signups: number
  active_users: number
  ai_calls: number
  sync_succeeded: number
  sync_failed: number
}

export type SuperAdminPlan = {
  id: string
  name: string
  price_monthly: number
  is_active: boolean
}

export type SuperAdminConsole = {
  generated_at: string
  users: SuperAdminUser[]
  timeseries: SuperAdminTimeseriesPoint[]
  plans: SuperAdminPlan[]
}

export async function verifySuperAdmin(): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('is_super_admin')
  if (error) throw error
  return data === true
}

export async function getSuperAdminData(): Promise<{ kpis: SuperAdminKpis; console: SuperAdminConsole }> {
  const client = getSupabase()
  const [kpiResult, consoleResult] = await Promise.all([
    client.rpc('get_super_admin_kpis'),
    client.rpc('get_super_admin_console'),
  ])
  if (kpiResult.error) throw kpiResult.error
  if (consoleResult.error) throw consoleResult.error
  return {
    kpis: kpiResult.data as SuperAdminKpis,
    console: consoleResult.data as SuperAdminConsole,
  }
}

export async function setUserAccess(userId: string, accessType: SuperAdminUser['account_type'], paidPlan?: string): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_user_access', {
    target_user: userId,
    access_type: accessType,
    paid_plan: paidPlan ?? null,
  })
  if (error) throw error
}
