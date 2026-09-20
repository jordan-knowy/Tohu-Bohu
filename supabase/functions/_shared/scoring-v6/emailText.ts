// Texte « écrit par l'expéditeur » d'un email, pour le classificateur sémantique.
// Le corps stocké (communication_messages.body_text) contient l'historique cité
// (« Le … a écrit : », « De : … », lignes « > ») : sans le retirer, une phrase
// écrite par NOTRE côté serait attribuée au contact (faux marqueur). Pur, testé.

export const MIN_CLASSIFIABLE_CHARS = 20
export const MAX_CLASSIFIABLE_CHARS = 4000

// Début d'un historique cité. On coupe au premier séparateur rencontré.
const QUOTE_START = [
  /^\s*le\s.{5,200}\sa\s[ée]crit\s*:?\s*$/i,
  /^\s*on\s.{5,200}\swrote\s*:?\s*$/i,
  /^\s*-{2,}\s*(message d'origine|original message|forwarded message|message transf[ée]r[ée])\s*-{2,}/i,
  /^\s*_{5,}\s*$/,
  /^\s*\*?(de|from)\s*:\*?\s.+/i, // « De : », « From: », « *From:* » (rendu markdown de Gmail)
  /^\s*>/,
]

/** Retire l'historique cité et borne la longueur. Renvoie '' si trop court pour être interprété. */
export function extractAuthoredText(body: string | null | undefined): string {
  if (!body) return ''
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (QUOTE_START.some((pattern) => pattern.test(line))) break
    kept.push(line)
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CLASSIFIABLE_CHARS)
  return text.length >= MIN_CLASSIFIABLE_CHARS ? text : ''
}
