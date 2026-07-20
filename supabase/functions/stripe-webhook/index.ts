import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const parts = signature.split(',').map((part) => part.split('='))
  const timestamp = parts.find(([key]) => key === 't')?.[1]
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value)
  if (!timestamp || signatures.length === 0) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)))
  return signatures.some((candidate) => safeEqual(candidate, digest))
}

type StripeObject = Record<string, any>

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    const signature = request.headers.get('Stripe-Signature')
    if (!webhookSecret || !signature) return json({ error: 'Webhook Stripe non configuré.' }, 503)
    const payload = await request.text()
    if (!await verifySignature(payload, signature, webhookSecret)) return json({ error: 'Signature invalide.' }, 400)

    const event = JSON.parse(payload)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { error: eventError } = await supabase.from('stripe_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
    })
    if (eventError?.code === '23505') return json({ received: true, duplicate: true })
    if (eventError) throw eventError

    const object = event.data?.object as StripeObject
    let stripeSubscriptionId: string | null = null
    if (event.type.startsWith('customer.subscription.')) stripeSubscriptionId = object.id
    if (event.type === 'checkout.session.completed') {
      stripeSubscriptionId = typeof object.subscription === 'string' ? object.subscription : null
    }
    if (event.type.startsWith('invoice.')) {
      stripeSubscriptionId = typeof object.subscription === 'string'
        ? object.subscription
        : object.parent?.subscription_details?.subscription ?? null
    }
    if (!stripeSubscriptionId) return json({ received: true, ignored: true })

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY manquante.')
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
    })
    const stripeSubscription = await response.json()
    if (!response.ok) throw new Error(stripeSubscription?.error?.message ?? 'Abonnement Stripe introuvable.')

    const customerId = typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id
    const firstItem = stripeSubscription.items?.data?.[0]
    const priceId = firstItem?.price?.id ?? null
    const organizationId = stripeSubscription.metadata?.organization_id
      ?? object.metadata?.organization_id
      ?? object.client_reference_id
    if (!organizationId) throw new Error('organization_id absent des métadonnées Stripe.')

    const { data: mappedPlan } = priceId
      ? await supabase.from('subscription_plans')
        .select('id,price_monthly,price_yearly,stripe_price_monthly_id,stripe_price_yearly_id')
        .or(`stripe_price_monthly_id.eq.${priceId},stripe_price_yearly_id.eq.${priceId}`)
        .maybeSingle()
      : { data: null }
    const planId = mappedPlan?.id ?? stripeSubscription.metadata?.plan_id
    if (!planId) throw new Error('Plan Tohu impossible à déterminer depuis le tarif Stripe.')

    const isYearly = mappedPlan?.stripe_price_yearly_id === priceId
      || firstItem?.price?.recurring?.interval === 'year'
    const statusMap: Record<string, string> = {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      unpaid: 'past_due',
      canceled: 'canceled',
      paused: 'paused',
      incomplete: 'paused',
      incomplete_expired: 'canceled',
    }
    const values = {
      plan_id: planId,
      status: statusMap[stripeSubscription.status] ?? 'paused',
      billing_cycle: isYearly ? 'yearly' : 'monthly',
      amount_per_period: Number(firstItem?.price?.unit_amount ?? 0) * Number(firstItem?.quantity ?? 1),
      seat_quantity: Math.max(1, Number(firstItem?.quantity ?? 1)),
      current_period_start: firstItem?.current_period_start
        ? new Date(firstItem.current_period_start * 1000).toISOString()
        : new Date().toISOString(),
      current_period_end: firstItem?.current_period_end
        ? new Date(firstItem.current_period_end * 1000).toISOString()
        : new Date().toISOString(),
      cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
      canceled_at: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000).toISOString()
        : null,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: customerId,
      stripe_price_id: priceId,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabase.from('subscriptions')
      .select('id').eq('organization_id', organizationId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const result = existing
      ? await supabase.from('subscriptions').update(values).eq('id', existing.id)
      : await supabase.from('subscriptions').insert({ organization_id: organizationId, ...values })
    if (result.error) throw result.error

    await supabase.from('audit_logs').insert({
      organization_id: organizationId,
      action: 'stripe_subscription_synchronized',
      target_table: 'subscriptions',
      target_id: existing?.id ?? null,
      metadata: { event_id: event.id, event_type: event.type, plan_id: planId, seat_quantity: values.seat_quantity },
    })
    return json({ received: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Webhook impossible.' }, 500)
  }
})
