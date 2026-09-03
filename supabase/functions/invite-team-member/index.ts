import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { EMAIL_FROM, EMAIL_REPLY_TO } from '../_shared/email.ts'
import { renderTeamInvite } from '../_shared/email-templates/invitation.ts'

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

    const [{ data: subscription }, { count: memberCount }, { count: pendingInvitationCount }, { data: existingInvitation }] = await Promise.all([
      supabase.from('subscriptions')
        .select('plan_id,seat_quantity,subscription_plans(max_licenses)')
        .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      // Une invitation 'pending' réserve un siège (sinon on pourrait inviter plus
      // de monde que de sièges payés et ne s'en apercevoir qu'à l'acceptation).
      // Annuler l'invitation (status='revoked') libère donc automatiquement ce siège.
      supabase.from('organization_invitations').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId).eq('status', 'pending'),
      supabase.from('organization_invitations').select('id,status')
        .eq('organization_id', organizationId).eq('email', email).maybeSingle(),
    ])

    const planLimit = Number((subscription?.subscription_plans as { max_licenses?: number } | null)?.max_licenses ?? 1)
    // max_licenses = -1 est le sentinel « illimité » (enterprise/super_admin/tester) —
    // aucune vérification de siège ne s'applique dans ce cas.
    if (planLimit >= 0) {
      const paidSeats = Math.max(1, Number(subscription?.seat_quantity ?? 1))
      const effectiveSeats = Math.min(planLimit, paidSeats)
      const usedSeats = (memberCount ?? 0) + (pendingInvitationCount ?? 0)
      if (usedSeats >= effectiveSeats) {
        return json({
          error: 'Tous les sièges actifs sont occupés. Ajoute d’abord un siège à ton abonnement.',
          code: 'seat_required',
        }, 409)
      }
    }
    if (existingInvitation?.status === 'pending') {
      return json({ error: 'Une invitation est déjà en attente pour cette adresse.' }, 409)
    }

    const redirectTo = `${Deno.env.get('APP_URL') ?? 'https://tohu.co'}/app/account?invitation=accepted`
    // generateLink (au lieu de inviteUserByEmail) ne déclenche AUCUN email — il ne
    // fait que créer/retrouver l'utilisateur et fournir le lien d'action. L'email
    // envoyé à la personne invitée est le nôtre, via Resend + la DA Tohu, plus bas.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo, data: { invited_organization_id: organizationId } },
    })
    let inviteUrl = redirectTo
    if (linkError) {
      // Déjà un compte Tohu (autre organisation) : rien à créer, un lien de
      // connexion classique suffit — la personne rejoint l'organisation une fois
      // connectée (organization_invitations, upserté plus bas, fait foi).
      if (!/already.*registered|already.*exists/i.test(linkError.message)) throw linkError
    } else if (linkData?.properties?.action_link) {
      inviteUrl = linkData.properties.action_link
    }

    const { data: inviterProfile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    const { data: organization } = await supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
    const rendered = renderTeamInvite({
      inviterName: String(inviterProfile?.full_name ?? user.email ?? 'Un membre de l’équipe'),
      organizationName: String(organization?.name ?? 'ton équipe'),
      role,
      inviteUrl,
    })
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) throw new Error('RESEND_API_KEY manquant')
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [email], subject: rendered.subject, html: rendered.html, reply_to: EMAIL_REPLY_TO,
        tags: [{ name: 'type', value: 'team_invite' }],
      }),
    })
    if (!emailResponse.ok) {
      const payload = await emailResponse.json().catch(() => ({}))
      throw new Error(`Resend ${emailResponse.status}: ${JSON.stringify(payload).slice(0, 200)}`)
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

