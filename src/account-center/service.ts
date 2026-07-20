import { absoluteUrl, getSupabase } from '../lib/supabase'

export type AccountPlan = {
  id: 'free' | 'solo' | 'pro' | 'business'
  name: string
  description: string
  price_monthly: number
  price_yearly: number
  max_licenses: number
  features: string[]
  entitlements: Record<string, unknown>
}

export type AccountSubscription = {
  id?: string
  plan_id: string
  status: string
  billing_cycle: 'monthly' | 'yearly'
  amount_per_period: number
  seat_quantity: number
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  trial_ends_at?: string | null
  notes?: string | null
}

export type AccountMember = {
  user_id: string
  full_name: string
  email: string
  avatar_url: string | null
  role: 'owner' | 'admin' | 'member'
  created_at: string
}

export type AccountInvitation = {
  id: string
  email: string
  role: 'admin' | 'member'
  status: string
  expires_at: string
  created_at: string
}

export type AccountConnector = {
  id: string
  provider: string
  status: string
  last_synced_at: string | null
  account_email: string | null
}

export type AccountCenter = {
  organization: { id: string; name: string; slug: string }
  can_manage: boolean
  plans: AccountPlan[]
  subscription: AccountSubscription
  members: AccountMember[]
  invitations: AccountInvitation[]
  connectors: AccountConnector[]
}

export type BillingInvoice = {
  id: string
  number: string | null
  status: string
  amountPaid: number
  amountDue: number
  currency: string
  created: number
  invoicePdf: string | null
  hostedInvoiceUrl: string | null
}

export type BillingSummary = {
  configured: boolean
  customerLinked: boolean
  upcoming: { amountDue: number; currency: string; date: number | null } | null
  paymentMethod: { brand?: string; last4?: string; expMonth?: number; expYear?: number; type?: string } | null
  invoices: BillingInvoice[]
}

export type AccountDeletionRequest = {
  id: string
  status: 'pending' | 'reviewing' | 'confirmed' | 'completed' | 'rejected' | 'cancelled'
  requested_at: string
  reviewed_at: string | null
  completed_at: string | null
}

export const emptyBillingSummary: BillingSummary = {
  configured: false,
  customerLinked: false,
  upcoming: null,
  paymentMethod: null,
  invoices: [],
}

export async function getAccountCenter(organizationId: string): Promise<AccountCenter> {
  const { data, error } = await getSupabase().rpc('get_account_center', { p_organization_id: organizationId })
  if (error) throw error
  return data as AccountCenter
}

export async function getMyAccountDeletionRequest(): Promise<AccountDeletionRequest | null> {
  const { data, error } = await getSupabase().rpc('get_my_account_deletion_request')
  if (error) throw error
  return data as AccountDeletionRequest | null
}

export async function submitAccountDeletionRequest(values: {
  organizationId: string
  primaryReason: string
  retentionFactor: string
  deletionScope: string
  details: string
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('submit_account_deletion_request', {
    p_organization_id: values.organizationId,
    p_primary_reason: values.primaryReason,
    p_retention_factor: values.retentionFactor,
    p_deletion_scope: values.deletionScope,
    p_details: values.details.trim(),
  })
  if (error) throw error
  return String(data)
}

async function billingAction(organizationId: string, body: Record<string, unknown>) {
  const { data, error } = await getSupabase().functions.invoke('billing-account', {
    body: { organizationId, returnUrl: absoluteUrl('/app/account'), ...body },
  })
  if (error) throw error
  if (data?.error) throw new Error(String(data.error))
  return data
}

export async function getBillingSummary(organizationId: string): Promise<BillingSummary> {
  return billingAction(organizationId, { action: 'summary' }) as Promise<BillingSummary>
}

export async function startPlanChange(
  organizationId: string,
  planId: string,
  billingCycle: 'monthly' | 'yearly',
  seatQuantity: number,
): Promise<string> {
  const data = await billingAction(organizationId, { action: 'checkout', planId, billingCycle, seatQuantity })
  return String(data.url)
}

export async function openBillingPortal(
  organizationId: string,
  flow?: 'payment_method_update',
): Promise<string> {
  const data = await billingAction(organizationId, { action: 'portal', flow })
  return String(data.url)
}

export async function inviteTeamMember(
  organizationId: string,
  email: string,
  role: 'admin' | 'member',
): Promise<void> {
  const { data, error } = await getSupabase().functions.invoke('invite-team-member', {
    body: { organizationId, email, role },
  })
  if (error) throw error
  if (data?.error) throw new Error(String(data.error))
}
