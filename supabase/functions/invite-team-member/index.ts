import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
    const email = String(body.email ?? '').trim().toLowerCase()
    const role = body.role === 'admin' ? 'admin' : 'member'
    if (!organizationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Adresse email invalide.' }, 400)
    }

    const { data: membership } = await supabase.from('memberships')
      .select('role').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Seul un owner ou un admin peut inviter un membre.' }, 403)
    }

    const [{ data: subscription }, { count: memberCount }, { data: existingInvitation }] = await Promise.all([
      supabase.from('subscriptions')
        .select('plan_id,seat_quantity,subscription_plans(max_licenses)')
        .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      supabase.from('organization_invitations').select('id,status')
        .eq('organization_id', organizationId).eq('email', email).maybeSingle(),
    ])

    const planLimit = Number((subscription?.subscription_plans as { max_licenses?: number } | null)?.max_licenses ?? 1)
    const paidSeats = Math.max(1, Number(subscription?.seat_quantity ?? 1))
    const effectiveSeats = planLimit > 0 ? Math.min(planLimit, paidSeats) : paidSeats
    if ((memberCount ?? 0) >= effectiveSeats) {
      return json({
        error: 'Tous les sièges actifs sont occupés. Ajoute d’abord un siège à ton abonnement.',
        code: 'seat_required',
      }, 409)
    }
    if (existingInvitation?.status === 'pending') {
      return json({ error: 'Une invitation est déjà en attente pour cette adresse.' }, 409)
    }

    const redirectTo = `${Deno.env.get('APP_URL') ?? 'http://127.0.0.1:5173'}/app/account?invitation=accepted`
    const { error: invitationError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invited_organization_id: organizationId },
    })
    if (invitationError && !/already.*registered|already.*exists/i.test(invitationError.message)) {
      throw invitationError
    }

    const { error: upsertError } = await supabase.from('organization_invitations').upsert({
      organization_id: organizationId,
      email,
      role,
      invited_by: user.id,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      accepted_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,email' })
    if (upsertError) throw upsertError

    await supabase.from('audit_logs').insert({
      organization_id: organizationId,
      actor_user_id: user.id,
      action: 'team_member_invited',
      target_table: 'organization_invitations',
      metadata: { email, role },
    })
    return json({ success: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invitation impossible.' }, 500)
  }
})

