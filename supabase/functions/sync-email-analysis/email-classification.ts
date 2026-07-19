export type EmailAutomationInput = {
  email: string
  name?: string
  subject?: string
  body?: string
  headers?: Record<string, string>
}

export type EmailAutomationClassification = {
  automated: boolean
  reasons: string[]
}

function normalized(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const target = name.toLowerCase()
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === target)
  return normalized(entry?.[1])
}

/**
 * Classe uniquement les expéditeurs qui présentent des signaux explicites
 * d'automatisation. Une personne déjà intégrée manuellement peut contourner
 * ce filtre dans la fonction de synchronisation.
 */
export function classifyEmailAutomation(input: EmailAutomationInput): EmailAutomationClassification {
  const email = normalized(input.email)
  const localPart = email.split('@')[0] ?? ''
  const name = normalized(input.name)
  const subject = normalized(input.subject)
  const body = normalized(input.body)
  const reasons: string[] = []
  let score = 0

  if (/(^|[._+-])(no-?reply|do-?not-?reply|noreply|bounce|mailer-daemon|postmaster)([._+-]|$)/.test(localPart)) {
    reasons.push('adresse technique')
    score += 8
  } else if (/(^|[._+-])(notification|notifications|alert|alerts|newsletter|digest|updates?|marketing|campaigns?)([._+-]|$)/.test(localPart)) {
    reasons.push('adresse automatisée')
    score += 6
  } else if (/^(info|contact|support|help|hello|team|sales|billing|invoice|invoices|facturation|admin|office|events?)$/.test(localPart)) {
    reasons.push('boîte générique')
    score += 5
  }

  const autoSubmitted = headerValue(input.headers, 'auto-submitted')
  const precedence = headerValue(input.headers, 'precedence')
  if (
    headerValue(input.headers, 'list-unsubscribe')
    || headerValue(input.headers, 'list-id')
    || (autoSubmitted && autoSubmitted !== 'no')
    || /bulk|list|junk/.test(precedence)
    || headerValue(input.headers, 'x-auto-response-suppress')
  ) {
    reasons.push('en-têtes de diffusion')
    score += 8
  }

  if (/\b(newsletter|digest|lettre d'information|notification automatique|alerte automatique|weekly roundup|monthly roundup)\b/.test(subject)) {
    reasons.push('objet de diffusion')
    score += 3
  }

  if (/\b(newsletter|notifications?|marketing|customer success team|equipe support|service client)\b/.test(name)) {
    reasons.push('nom d’expéditeur générique')
    score += 2
  }

  const optOutSignals = [
    /\bunsubscribe\b/,
    /\bse desabonner\b/,
    /\bdesinscription\b/,
    /\bmanage (your )?(email )?preferences\b/,
    /\bgerer (vos|mes) preferences\b/,
    /\bview (this email )?in (your )?browser\b/,
    /\bvoir (cet email|ce message) dans (votre|le) navigateur\b/,
  ].filter((pattern) => pattern.test(body)).length
  if (optOutSignals >= 1) {
    reasons.push('liens de désabonnement')
    score += optOutSignals >= 2 ? 5 : 3
  }

  if (/\b(promotion|offre speciale|code promo|nos actualites|weekly update|monthly update)\b/.test(subject + ' ' + body.slice(-1200))) {
    reasons.push('contenu de campagne')
    score += 2
  }

  return { automated: score >= 5, reasons }
}
