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
  customer_since: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  last_activity_at: string | null
  onboarding_completed: boolean
  platform_role: string
  is_super_admin: boolean
  organization_id: string | null
  organization_name: string | null
  membership_role: string | null
  membership_created_at: string | null
  subscription_id: string | null
  plan_id: string
  plan_name: string
  subscription_status: string
  billing_cycle: string | null
  amount_per_period: number
  seat_quantity: number
  subscription_started_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  subscription_created_at: string | null
  subscription_updated_at: string | null
  plan_changed_at: string | null
  stripe_managed: boolean
  account_type: 'free' | 'paid' | 'test'
  plan_history: SubscriptionChange[]
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

export type SubscriptionChange = {
  id: string
  previous_plan_id: string | null
  previous_plan_name: string | null
  new_plan_id: string
  new_plan_name: string
  previous_status: string | null
  new_status: string
  previous_billing_cycle: string | null
  new_billing_cycle: string | null
  previous_amount_per_period: number | null
  new_amount_per_period: number
  change_source: string
  changed_by: string | null
  changed_by_name: string | null
  reason: string | null
  changed_at: string
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
  price_yearly: number
  is_active: boolean
}

export type SuperAdminConsole = {
  generated_at: string
  users: SuperAdminUser[]
  timeseries: SuperAdminTimeseriesPoint[]
  plans: SuperAdminPlan[]
}

export type AccountDeletionRequestAdmin = {
  id: string
  user_id: string
  email: string
  full_name: string
  organization_id: string | null
  organization_name: string | null
  primary_reason: string
  retention_factor: string
  deletion_scope: string
  details: string
  status: 'pending' | 'reviewing' | 'confirmed' | 'completed' | 'rejected' | 'cancelled'
  admin_note: string | null
  assigned_to: string | null
  requested_at: string
  reviewed_at: string | null
  completed_at: string | null
  updated_at: string
}

export async function verifySuperAdmin(): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('is_super_admin')
  if (error) throw error
  return data === true
}

export type ManualEnrichmentResult = {
  success: boolean
  scanned: number
  enriched: number
  failed: number
  signals: number
  notified: number
}

/** invokeError : FunctionsHttpError.message est générique, le vrai détail est dans error.context. */
async function invokeError(error: unknown, fallback: string): Promise<Error> {
  const detail = await (error as { context?: Response })?.context?.clone?.().json?.().catch(() => null)
  if (detail?.error) return new Error(String(detail.error))
  return error instanceof Error && !error.message.includes('non-2xx') ? error : new Error(fallback)
}

/** Mode enrichissement manuel global : réservé aux super admins (vérifié côté edge function,
 *  pas seulement côté UI). N'envoie pas organizationId → balaie tous les workspaces. */
export async function triggerManualEnrichment(): Promise<ManualEnrichmentResult> {
  const { data, error } = await getSupabase().functions.invoke('monitor-contacts', { body: {} })
  if (error) throw await invokeError(error, 'Déclenchement de l’enrichissement impossible.')
  if (data?.error) throw new Error(String(data.error))
  return data as ManualEnrichmentResult
}

export async function getSuperAdminData(): Promise<{ kpis: SuperAdminKpis; console: SuperAdminConsole; deletionRequests: AccountDeletionRequestAdmin[] }> {
  const client = getSupabase()
  const [kpiResult, consoleResult, deletionResult] = await Promise.all([
    client.rpc('get_super_admin_kpis'),
    client.rpc('get_super_admin_console'),
    client.rpc('admin_list_account_deletion_requests'),
  ])
  if (kpiResult.error) throw kpiResult.error
  if (consoleResult.error) throw consoleResult.error
  if (deletionResult.error) throw deletionResult.error
  return {
    kpis: kpiResult.data as SuperAdminKpis,
    console: consoleResult.data as SuperAdminConsole,
    deletionRequests: deletionResult.data as AccountDeletionRequestAdmin[],
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

/** Sièges souscrits pour le workspace de l'utilisateur — réservé aux super admins. */
export async function setUserSeats(userId: string, seats: number): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_seat_quantity', {
    target_user: userId,
    seats,
  })
  if (error) throw error
}

export async function setSuperAdminRole(userId: string, makeAdmin: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_super_admin', {
    target_user: userId,
    make_admin: makeAdmin,
  })
  if (error) throw error
}

export type EmailDispatchScope = 'global' | 'account_type' | 'user'
export type EmailDispatchType = 'digest' | 'antiseche' | 'alerte' | 'nurturing'
export type EmailDispatchRule = { scope: EmailDispatchScope; scope_ref: string; email_type: EmailDispatchType; enabled: boolean }

export async function getEmailDispatchRules(): Promise<EmailDispatchRule[]> {
  const { data, error } = await getSupabase().rpc('admin_get_email_dispatch_rules')
  if (error) throw error
  return (data ?? []).map((row: any) => ({ scope: row.scope, scope_ref: row.scope_ref, email_type: row.email_type, enabled: row.enabled }))
}

export async function setEmailDispatchRule(scope: EmailDispatchScope, scopeRef: string, emailType: EmailDispatchType, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_email_dispatch_rule', { p_scope: scope, p_scope_ref: scopeRef, p_email_type: emailType, p_enabled: enabled })
  if (error) throw error
}

export async function updateAccountDeletionRequest(
  requestId: string,
  status: AccountDeletionRequestAdmin['status'],
  adminNote: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('admin_update_account_deletion_request', {
    p_request_id: requestId,
    p_status: status,
    p_admin_note: adminNote.trim() || null,
  })
  if (error) throw error
}

// ── Suivi IA & coûts ────────────────────────────────────────────────────────
export type AiUsageBucket = { calls: number; tokens: number; cost: number }
export type AiUsageStats = {
  generated_at: string
  totals: Record<'day' | 'week' | 'month' | 'year' | 'all', AiUsageBucket>
  by_function: Array<{ fn: string } & AiUsageBucket>
  by_model: Array<{ model: string } & AiUsageBucket>
  by_day: Array<{ day: string } & AiUsageBucket>
  by_user: Array<{ user_id: string | null; full_name: string } & AiUsageBucket>
}

/** Agrégats d'usage IA (tokens réels OpenRouter + coût estimé). Super-admin only. */
export async function getAiUsage(): Promise<AiUsageStats> {
  const { data, error } = await getSupabase().rpc('super_admin_ai_usage')
  if (error) throw error
  return data as AiUsageStats
}

// ── Adhésions (qui est membre de qui) ────────────────────────────────────────
export type SuperAdminMembership = {
  membership_id: string
  organization_id: string
  organization_name: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
}
export type SuperAdminOrganization = { id: string; name: string }

export async function getUserMemberships(userId: string): Promise<SuperAdminMembership[]> {
  const { data, error } = await getSupabase().rpc('admin_list_user_memberships', { target_user: userId })
  if (error) throw error
  return (data ?? []) as SuperAdminMembership[]
}

export async function getOrganizationsList(): Promise<SuperAdminOrganization[]> {
  const { data, error } = await getSupabase().rpc('admin_list_organizations')
  if (error) throw error
  return (data ?? []) as SuperAdminOrganization[]
}

export async function addUserToOrganization(userId: string, organizationId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await getSupabase().rpc('admin_add_user_to_organization', {
    target_user: userId, target_organization_id: organizationId, target_role: role,
  })
  if (error) throw error
}

export async function removeUserFromOrganization(membershipId: string): Promise<void> {
  const { error } = await getSupabase().rpc('admin_remove_user_from_organization', { p_membership_id: membershipId })
  if (error) throw error
}

export async function setMembershipRole(membershipId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_membership_role', { p_membership_id: membershipId, p_role: role })
  if (error) throw error
}

/** Suppression complète d'un utilisateur + cascade de ses données (super admin). */
export async function deleteSuperAdminUser(userId: string): Promise<{ deleted_email: string; organizations_deleted: number }> {
  const { data, error } = await getSupabase().rpc('admin_delete_user', { p_user_id: userId })
  if (error) throw error
  return data as { deleted_email: string; organizations_deleted: number }
}
