import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function stripeRequest(path: string, secret: string, params?: URLSearchParams, method = 'POST') {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message ?? `Stripe a répondu ${response.status}.`)
  return data
}

function safeOrigin(value: unknown): string {
  try {
    const url = new URL(String(value ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid')
    return url.origin
  } catch {
    return Deno.env.get('APP_URL') ?? 'http://127.0.0.1:5173'
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise.' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide.' }, 401)

    const body = await request.json().catch(() => ({}))
    const organizationId = String(body.organizationId ?? '')
    const action = String(body.action ?? 'summary')
    const returnUrl = `${safeOrigin(body.returnUrl)}/app/account`

    const { data: membership } = await supabase
      .from('memberships')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return json({ error: 'Accès refusé à ce workspace.' }, 403)

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
    if (action === 'summary') {
      if (!stripeSecret || !subscription?.stripe_customer_id) {
        return json({
          configured: Boolean(stripeSecret),
          customerLinked: false,
          upcoming: null,
          paymentMethod: null,
          invoices: [],
        })
      }

      const customerId = subscription.stripe_customer_id
      const [customerResult, invoiceResult, previewResult] = await Promise.allSettled([
        stripeRequest(`/v1/customers/${encodeURIComponent(customerId)}`, stripeSecret, undefined, 'GET'),
        stripeRequest(`/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=12`, stripeSecret, undefined, 'GET'),
        stripeRequest('/v1/invoices/create_preview', stripeSecret, new URLSearchParams({ customer: customerId })),
      ])
      const customer = customerResult.status === 'fulfilled' ? customerResult.value : null
      const invoices = invoiceResult.status === 'fulfilled' ? invoiceResult.value.data ?? [] : []
      const preview = previewResult.status === 'fulfilled' ? previewResult.value : null
      let paymentMethod = null
      const paymentMethodId = typeof customer?.invoice_settings?.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : null
      if (paymentMethodId) {
        try {
          const method = await stripeRequest(`/v1/payment_methods/${encodeURIComponent(paymentMethodId)}`, stripeSecret, undefined, 'GET')
          paymentMethod = method.card ? {
            brand: method.card.brand,
            last4: method.card.last4,
            expMonth: method.card.exp_month,
            expYear: method.card.exp_year,
          } : { type: method.type }
        } catch {
          paymentMethod = null
        }
      }

      return json({
        configured: true,
        customerLinked: true,
        upcoming: preview ? {
          amountDue: preview.amount_due,
          currency: preview.currency,
          date: preview.next_payment_attempt ?? preview.period_end ?? null,
        } : null,
        paymentMethod,
        invoices: invoices.map((invoice: Record<string, unknown>) => ({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          amountPaid: invoice.amount_paid,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          created: invoice.created,
          invoicePdf: invoice.invoice_pdf,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
        })),
      })
    }

    if (!['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Seul un owner ou un admin peut gérer la facturation.' }, 403)
    }
    if (!stripeSecret) return json({ error: 'Stripe n’est pas encore configuré côté serveur.' }, 503)

    if (action === 'portal') {
      if (!subscription?.stripe_customer_id) return json({ error: 'Aucun compte de facturation Stripe n’est encore lié.' }, 409)
      const params = new URLSearchParams({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
        locale: 'fr',
      })
      if (body.flow === 'payment_method_update') params.set('flow_data[type]', 'payment_method_update')
      const session = await stripeRequest('/v1/billing_portal/sessions', stripeSecret, params)
      return json({ url: session.url })
    }

    if (action !== 'checkout') return json({ error: 'Action inconnue.' }, 400)

    const planId = String(body.planId ?? '')
    const billingCycle = body.billingCycle === 'yearly' ? 'yearly' : 'monthly'
    const requestedSeats = Math.max(1, Math.floor(Number(body.seatQuantity ?? 1)))
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id,name,max_licenses,stripe_price_monthly_id,stripe_price_yearly_id,is_active')
      .eq('id', planId)
      .in('id', ['solo', 'pro', 'business'])
      .eq('is_active', true)
      .maybeSingle()
    if (!plan) return json({ error: 'Ce plan commercial n’est pas disponible.' }, 400)

    const maxLicenses = Number(plan.max_licenses)
    const seats = maxLicenses > 0 ? Math.min(requestedSeats, maxLicenses) : requestedSeats
    const priceId = billingCycle === 'yearly' ? plan.stripe_price_yearly_id : plan.stripe_price_monthly_id
    if (!priceId) return json({ error: `Le tarif Stripe ${plan.name} n’est pas encore configuré.` }, 503)

    if (subscription?.stripe_customer_id && subscription?.stripe_subscription_id) {
      const stripeSubscription = await stripeRequest(
        `/v1/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`,
        stripeSecret,
        undefined,
        'GET',
      )
      const itemId = stripeSubscription?.items?.data?.[0]?.id
      if (!itemId) return json({ error: 'La ligne d’abonnement Stripe est introuvable.' }, 409)
      const params = new URLSearchParams({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
        'flow_data[type]': 'subscription_update_confirm',
        'flow_data[subscription_update_confirm][subscription]': subscription.stripe_subscription_id,
        'flow_data[subscription_update_confirm][items][0][id]': itemId,
        'flow_data[subscription_update_confirm][items][0][price]': priceId,
        'flow_data[subscription_update_confirm][items][0][quantity]': String(seats),
        'flow_data[after_completion][type]': 'redirect',
        'flow_data[after_completion][redirect][return_url]': `${returnUrl}?billing=updated`,
      })
      const portal = await stripeRequest('/v1/billing_portal/sessions', stripeSecret, params)
      return json({ url: portal.url })
    }

    const params = new URLSearchParams({
      mode: 'subscription',
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=canceled`,
      client_reference_id: organizationId,
      customer_email: user.email ?? '',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': String(seats),
      'subscription_data[metadata][organization_id]': organizationId,
      'subscription_data[metadata][plan_id]': planId,
      'subscription_data[metadata][billing_cycle]': billingCycle,
      'metadata[organization_id]': organizationId,
      'metadata[plan_id]': planId,
      'metadata[seat_quantity]': String(seats),
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      locale: 'fr',
    })
    const checkout = await stripeRequest('/v1/checkout/sessions', stripeSecret, params)
    return json({ url: checkout.url })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur de facturation.' }, 500)
  }
})

