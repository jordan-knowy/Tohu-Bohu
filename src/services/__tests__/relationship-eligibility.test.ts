import { describe, expect, it } from 'vitest'
import { reciprocalExternalEmails, relationshipEvidenceByEmail } from '../../../supabase/functions/sync-email-analysis/relationship-eligibility'

const ownEmail = 'user@tohu.test'

function inbound(from: string) {
  return { direction: 'inbound' as const, from: { email: from }, to: [{ email: ownEmail }] }
}

function outbound(...recipients: string[]) {
  return { direction: 'outbound' as const, from: { email: ownEmail }, to: recipients.map((email) => ({ email })) }
}

describe('email relationship eligibility', () => {
  it('exclut une adresse uniquement entrante', () => {
    expect([...reciprocalExternalEmails([inbound('prospect@example.com')], ownEmail)]).toEqual([])
  })

  it('exclut une adresse uniquement sortante', () => {
    expect([...reciprocalExternalEmails([outbound('prospect@example.com')], ownEmail)]).toEqual([])
  })

  it('conserve seulement les adresses avec au moins un message dans chaque sens', () => {
    const result = reciprocalExternalEmails([
      inbound('relation@example.com'),
      outbound('relation@example.com', 'sans-reponse@example.com'),
      inbound('entrant-seul@example.com'),
    ], ownEmail)

    expect([...result]).toEqual(['relation@example.com'])
  })

  it('normalise les adresses et ne double-compte pas un destinataire répété', () => {
    const evidence = relationshipEvidenceByEmail([
      inbound(' Relation@Example.com '),
      outbound('relation@example.com', 'RELATION@example.com'),
    ], ' USER@TOHU.TEST ')

    expect(evidence.get('relation@example.com')).toEqual({ inbound: 1, outbound: 1 })
  })
})
