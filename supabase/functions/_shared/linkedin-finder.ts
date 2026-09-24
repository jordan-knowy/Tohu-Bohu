// Agent LinkedIn dédié : retrouve le profil PUBLIC d'une personne (jamais de scraping).
// 1) URLs déjà remontées par l'agent d'enrichissement (sources) ; 2) recherche web ciblée.
// Toute URL est validée par correspondance nom ↔ identifiant (voir linkedin-match.ts).
import { extractProfileUrls, pickMatchingProfile } from './linkedin-match.ts'
import { getWebSearchSettings, readWebSearchKeys, runWebSearch } from './web-search.ts'

export type LinkedinQuery = {
  fullName: string
  company?: string | null
  domain?: string | null
  role?: string | null
  /** Sources/URLs déjà collectées par l'agent d'enrichissement. */
  knownSources?: string[]
}

function buildPrompt(query: LinkedinQuery, attempt: 1 | 2): string {
  const where = [query.role, query.company, query.domain ? `(${query.domain})` : null].filter(Boolean).join(' · ')
  return `Trouve l'URL du profil LinkedIn PERSONNEL PUBLIC de « ${query.fullName} »${where ? `, ${where}` : ''}.
${attempt === 2 ? 'Cherche « site:linkedin.com/in » avec le prénom et le nom, en tenant compte des variantes (accents, initiale du prénom).\n' : ''}Règles : uniquement une URL de la forme https://www.linkedin.com/in/… (jamais une page entreprise ni un annuaire). Ne devine JAMAIS une URL : si tu n'as pas trouvé un profil clairement correspondant à cette personne et à cette organisation, réponds null.
Réponds UNIQUEMENT en JSON : {"linkedinUrl":"https://www.linkedin.com/in/... ou null"}`
}

export async function findLinkedinProfile(db: { from: (table: string) => any }, query: LinkedinQuery): Promise<{ url: string; via: 'sources' | 'search' } | null> {
  const fullName = query.fullName.trim()
  if (!fullName) return null

  const fromSources = pickMatchingProfile(extractProfileUrls(query.knownSources ?? []), fullName)
  if (fromSources) return { url: fromSources, via: 'sources' }

  const keys = readWebSearchKeys()
  const settings = await getWebSearchSettings(db)
  for (const attempt of [1, 2] as const) {
    const result = await runWebSearch(keys, settings, [
      { role: 'system', content: 'Tu retrouves des profils LinkedIn publics. Factuel, aucune invention, JSON strict.' },
      { role: 'user', content: buildPrompt(query, attempt) },
    ], { maxTokens: 400, timeoutMs: 30000 })
    if ('error' in result) { console.error(`[linkedin-finder] recherche indisponible: ${result.error}`); return null }
    const url = pickMatchingProfile(extractProfileUrls(result.content, result.citations), fullName)
    if (url) return { url, via: 'search' }
  }
  return null
}
