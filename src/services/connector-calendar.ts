// Détecte si un agenda (Google ou Microsoft) est réellement connecté avec le
// scope calendrier — Gmail/Outlook connecté ne veut pas dire Calendar synchronisé.
// Logique reprise de home/service.ts::buildSources (mêmes providers/regex), extraite
// ici pour être réutilisée par le bloc "Prochain rendez-vous" des fiches Personnes
// sans dupliquer la détection.

export function hasCalendarScope(scopes: string[] | null | undefined): boolean {
  return (scopes ?? []).some((scope) => /calendar/i.test(scope))
}

export function isCalendarConnected(connectors: Array<{ provider: string; status: string; scopes?: string[] | null }>): boolean {
  return connectors.some((connector) =>
    (connector.provider === 'google' || connector.provider === 'microsoft')
    && connector.status === 'connected'
    && hasCalendarScope(connector.scopes))
}
