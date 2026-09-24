// Validation déterministe d'un profil LinkedIn PERSONNEL : aucune URL n'est acceptée
// sans que son identifiant (slug) corresponde au nom recherché — zéro invention.

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const PROFILE_URL = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'<>)\]},;|]+/gi

/** Identifiant du profil, sans accents ni casse (ex. "jframiara"), ou null si ce n'est pas un profil personnel. */
export function linkedinSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i)
  if (!match) return null
  let slug = match[1]
  try { slug = decodeURIComponent(slug) } catch { /* garde le slug brut */ }
  return normalize(slug)
}

/** URL canonique sans paramètres de suivi. */
export function canonicalLinkedinUrl(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i)
  return match ? `https://www.linkedin.com/in/${match[1]}` : null
}

/** Le nom ("Prénom NOM DE FAMILLE") est retrouvable dans l'identifiant : nom de famille présent
 *  ET prénom (ou son initiale en tête). Refuse les noms d'un seul mot. */
export function slugMatchesName(url: string, fullName: string): boolean {
  const slug = linkedinSlug(url)
  if (!slug) return false
  const tokens = normalize(fullName).split(/[^a-z]+/).filter((token) => token.length >= 2)
  if (tokens.length < 2) return false
  const letters = slug.replace(/[^a-z]/g, '')
  const [first, ...surname] = tokens
  const surnameHit = surname.some((token) => token.length >= 3 && letters.includes(token))
  const firstHit = letters.includes(first) || letters.startsWith(first[0])
  return surnameHit && firstHit
}

/** Toutes les URLs de profils personnels présentes dans des textes et des liens (sans doublon). */
export function extractProfileUrls(...chunks: Array<string | string[] | null | undefined>): string[] {
  const found = new Set<string>()
  for (const chunk of chunks.flat()) {
    if (!chunk) continue
    for (const raw of chunk.match(PROFILE_URL) ?? []) {
      const clean = canonicalLinkedinUrl(raw.replace(/[.,;:!?]+$/, ''))
      if (clean) found.add(clean)
    }
  }
  return [...found]
}

export function pickMatchingProfile(candidates: string[], fullName: string): string | null {
  return candidates.find((url) => slugMatchesName(url, fullName)) ?? null
}
