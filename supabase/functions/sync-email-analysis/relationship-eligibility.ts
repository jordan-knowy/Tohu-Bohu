export type RelationshipDirection = 'inbound' | 'outbound'

export type RelationshipMessage = {
  direction: RelationshipDirection
  from: { email: string }
  to: Array<{ email: string }>
}

export type RelationshipEvidence = {
  inbound: number
  outbound: number
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Compte les deux côtés d'une relation par adresse externe. Une adresse n'est
 * éligible que si la boîte connectée a reçu au moins un de ses messages ET lui
 * en a envoyé au moins un. Le calcul est volontairement fait avant toute
 * création de contact ou d'entreprise.
 *
 * `ownEmails` accepte TOUTES les identités du responsable connecté (adresse
 * du connecteur + alias déclarés, voir user_identity_aliases) : une adresse
 * qui nous appartient ne doit jamais être comptée comme un correspondant
 * externe, quel que soit l'alias par lequel elle nous est arrivée.
 */
export function relationshipEvidenceByEmail(
  messages: RelationshipMessage[],
  ownEmails: Set<string>,
): Map<string, RelationshipEvidence> {
  const normalizedOwnEmails = new Set([...ownEmails].map(normalizeEmail))
  const evidence = new Map<string, RelationshipEvidence>()

  for (const message of messages) {
    const externals = message.direction === 'inbound' ? [message.from] : message.to
    const uniqueEmails = new Set(externals
      .map((address) => normalizeEmail(address.email))
      .filter((email) => email && !normalizedOwnEmails.has(email)))

    for (const email of uniqueEmails) {
      const current = evidence.get(email) ?? { inbound: 0, outbound: 0 }
      current[message.direction]++
      evidence.set(email, current)
    }
  }

  return evidence
}

export function reciprocalExternalEmails(
  messages: RelationshipMessage[],
  ownEmails: Set<string>,
): Set<string> {
  return new Set([...relationshipEvidenceByEmail(messages, ownEmails)]
    .filter(([, evidence]) => evidence.inbound > 0 && evidence.outbound > 0)
    .map(([email]) => email))
}
