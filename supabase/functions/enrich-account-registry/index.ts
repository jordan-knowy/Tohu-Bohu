// Identité légale d'un compte, à la demande (bouton dans le panneau Coordonnées) —
// jamais en cron, jamais de matching automatique par nom d'entreprise (ambigu).
// Le SIREN est saisi/confirmé une fois par un humain, persisté sur companies.siren,
// puis réutilisé pour les actualisations suivantes.
//
// Deux sources, toutes deux facultatives indépendamment (best-effort) :
//   - INSEE Sirene (unité légale) : forme juridique, code NAF, effectif.
//   - INPI RNE : dirigeants (nom, rôle).
// Chaque fait est INSÉRÉ (jamais mis à jour en place) dans account_firmographic_facts
// avec une provenance datée et un lien vers l'annuaire officiel — même convention que
// account_strategic_readings (une ligne par génération, le front lit la plus récente).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const INSEE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11'
const INPI_BASE_URL = 'https://registre-national-entreprises.inpi.fr'
const REQUEST_TIMEOUT_MS = 12_000

// Codes "catégorie juridique" INSEE les plus courants côté PME/TPE françaises —
// liste volontairement partielle, le code brut est affiché si absent d'ici.
const CATEGORIE_JURIDIQUE_LABELS: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5202': 'Société en nom collectif',
  '5306': 'Société en commandite simple',
  '5410': 'SARL', '5498': 'EURL', '5499': 'SARL',
  '5599': 'SA à conseil d’administration', '5699': 'SA à directoire',
  '5710': 'SAS', '5720': 'SASU', '5785': 'SELAS',
  '6540': 'SCI', '6560': 'Société civile', '6599': 'Société civile',
  '9220': 'Association déclarée', '9300': 'Fondation', '9970': 'Groupement d’intérêt économique (GIE)',
}

const EFFECTIF_LABELS: Record<string, string> = {
  NN: 'Non renseigné', '00': '0 salarié', '01': '1 à 2 salariés', '02': '3 à 5 salariés',
  '03': '6 à 9 salariés', '11': '10 à 19 salariés', '12': '20 à 49 salariés', '21': '50 à 99 salariés',
  '22': '100 à 199 salariés', '31': '200 à 249 salariés', '32': '250 à 499 salariés',
  '41': '500 à 999 salariés', '42': '1 000 à 1 999 salariés', '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés', '53': '10 000 salariés et plus',
}

// Rôle INPI (RNE) → libellé lisible. L'INPI ne publie pas ce référentiel ; calibré
// sur des réponses réelles. Code inconnu → nom affiché sans titre.
const ROLE_LABELS: Record<string, string> = {
  '4': 'Directeur général unique', '5': 'Président', '23': 'Associé gérant', '29': 'Gérant', '30': 'Gérant',
  '40': 'Président du directoire', '41': 'Membre du directoire', '42': 'Président du conseil de surveillance',
  '51': 'Président', '52': 'Président du directoire', '53': 'Directeur général', '60': 'Président-directeur général',
  '61': 'Directeur général délégué', '62': 'Directeur général délégué', '65': 'Administrateur', '66': 'Vice-président',
  '70': 'Représentant permanent',
}
const EXECUTIVE_ROLE_CODES = new Set(['4', '5', '23', '29', '30', '40', '51', '52', '53', '60', '61', '62', '65'])
const MAX_DIRIGEANTS = 6

function fetchWithTimeout(url: string, init?: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

type Dirigeant = { name: string; role: string | null }

async function fetchInseeUnit(siren: string, apiKey: string): Promise<{ legalFormLabel: string | null; nafCode: string | null; employeeRange: string | null } | null> {
  const response = await fetchWithTimeout(`${INSEE_BASE_URL}/siren/${encodeURIComponent(siren)}`, {
    headers: { 'X-INSEE-Api-Key-Integration': apiKey, Accept: 'application/json' },
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  const unit = (payload?.uniteLegale ?? null) as Record<string, unknown> | null
  if (!unit) return null
  const periods = Array.isArray(unit.periodesUniteLegale) ? unit.periodesUniteLegale as Array<Record<string, unknown>> : []
  const current = periods.find((period) => period.dateFin === null) ?? periods[0] ?? {}
  const categorieCode = typeof unit.categorieJuridiqueUniteLegale === 'string' ? unit.categorieJuridiqueUniteLegale : null
  const nafCode = typeof current.activitePrincipaleUniteLegale === 'string' ? current.activitePrincipaleUniteLegale : null
  const effectifCode = typeof unit.trancheEffectifsUniteLegale === 'string' ? unit.trancheEffectifsUniteLegale : null
  return {
    legalFormLabel: categorieCode ? (CATEGORIE_JURIDIQUE_LABELS[categorieCode] ?? categorieCode) : null,
    nafCode,
    employeeRange: effectifCode ? (EFFECTIF_LABELS[effectifCode] ?? effectifCode) : null,
  }
}

async function inpiLogin(username: string, password: string): Promise<string | null> {
  const response = await fetchWithTimeout(`${INPI_BASE_URL}/api/sso/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  return typeof payload?.token === 'string' ? payload.token : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function mapIndividu(description: Record<string, unknown>, roleCode: string | null): Dirigeant | null {
  const nom = readString(description.nomUsage) ?? readString(description.nom)
  const prenomsRaw = description.prenoms
  const prenoms = Array.isArray(prenomsRaw) ? readString(prenomsRaw.map((entry) => readString(entry) ?? '').join(' ')) : readString(prenomsRaw)
  const name = [nom, prenoms].filter(Boolean).join(' ').trim()
  if (!name) return null
  const code = roleCode ?? readString(description.role)
  return { name, role: code ? (ROLE_LABELS[code] ?? null) : null }
}

function extractDirigeants(company: unknown): Dirigeant[] {
  const root = asRecord(company)
  if (!root) return []
  const formality = asRecord(root.formality) ?? asRecord(asArray(root.formalities)[0]) ?? root
  const content = asRecord(formality.content) ?? asRecord(root.content)
  if (!content) return []
  const personneMorale = asRecord(content.personneMorale)
  const personnePhysique = asRecord(content.personnePhysique)

  const pouvoirs: unknown[] = []
  if (personneMorale) {
    const composition = asRecord(personneMorale.composition)
    pouvoirs.push(...asArray(composition?.pouvoirs))
    pouvoirs.push(...asArray(personneMorale.pouvoirs))
  }

  const dirigeants: Dirigeant[] = []
  for (const pouvoirRaw of pouvoirs) {
    const record = asRecord(pouvoirRaw)
    if (!record || record.actif === false) continue
    const pouvoirRole = readString(record.roleEntreprise)
    const individu = asRecord(record.individu)
    if (individu) {
      const description = asRecord(individu.descriptionPersonne)
      const mapped = description ? mapIndividu(description, pouvoirRole) : null
      if (mapped) dirigeants.push(mapped)
    }
    const entreprise = asRecord(record.entreprise)
    if (entreprise) {
      const denomination = readString(entreprise.denomination) ?? readString(entreprise.nom)
      if (denomination) {
        const code = readString(entreprise.roleEntreprise) ?? pouvoirRole
        dirigeants.push({ name: denomination, role: code ? (ROLE_LABELS[code] ?? null) : null })
      }
    }
  }

  if (dirigeants.length === 0 && personnePhysique) {
    const identite = asRecord(personnePhysique.identite)
    const description = asRecord(asRecord(identite?.entrepreneur)?.descriptionPersonne)
      ?? asRecord(asRecord(identite?.entreprise)?.descriptionPersonne)
    if (description) {
      const mapped = mapIndividu(description, null)
      if (mapped) dirigeants.push(mapped)
    }
  }

  const seen = new Set<string>()
  const unique = dirigeants.filter((item) => {
    const key = item.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const isExecutive = (item: Dirigeant) => Object.entries(ROLE_LABELS).some(([code, label]) => label === item.role && EXECUTIVE_ROLE_CODES.has(code))
  return [...unique.filter(isExecutive), ...unique.filter((item) => !isExecutive(item))].slice(0, MAX_DIRIGEANTS)
}

async function fetchInpiDirigeants(siren: string, username: string, password: string): Promise<Dirigeant[]> {
  const token = await inpiLogin(username, password)
  if (!token) return []
  const response = await fetchWithTimeout(`${INPI_BASE_URL}/api/companies/${encodeURIComponent(siren)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!response.ok) return []
  const payload = await response.json().catch(() => null)
  const company = Array.isArray(payload) ? payload[0] : payload
  return extractDirigeants(company)
}

function formatDirigeants(dirigeants: Dirigeant[]): string | null {
  if (dirigeants.length === 0) return null
  return dirigeants.map((item) => (item.role ? `${item.name} — ${item.role}` : item.name)).join(' ; ')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentification requise' }, 401)
  const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
  if (userError || !user) return json({ error: 'Session invalide' }, 401)

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
  const companyId = typeof body.companyId === 'string' ? body.companyId : null
  const siren = typeof body.siren === 'string' ? body.siren.replace(/\s+/g, '') : null
  if (!organizationId || !companyId) return json({ error: 'Paramètres invalides' }, 400)
  if (!siren || !/^\d{9}$/.test(siren)) return json({ error: 'SIREN invalide — 9 chiffres attendus.' }, 400)

  const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return json({ error: 'Accès refusé' }, 403)

  const inseeKey = Deno.env.get('INSEE_API_KEY')
  const inpiUsername = Deno.env.get('INPI_USERNAME')
  const inpiPassword = Deno.env.get('INPI_PASSWORD')
  if (!inseeKey) return json({ error: 'INSEE_API_KEY non configurée côté serveur.' }, 500)

  const sourceUrl = `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`
  const observedAt = new Date().toISOString()
  const facts: Array<{ fact_key: string; value: string; source_label: string }> = [
    { fact_key: 'registration_number', value: siren, source_label: 'INSEE Sirene' },
  ]

  let unitError: string | null = null
  try {
    const unit = await fetchInseeUnit(siren, inseeKey)
    if (unit) {
      if (unit.legalFormLabel) facts.push({ fact_key: 'legal_form', value: unit.legalFormLabel, source_label: 'INSEE Sirene' })
      if (unit.nafCode) facts.push({ fact_key: 'naf_code', value: unit.nafCode, source_label: 'INSEE Sirene' })
      if (unit.employeeRange) facts.push({ fact_key: 'employee_range', value: unit.employeeRange, source_label: 'INSEE Sirene' })
    } else {
      unitError = 'SIREN introuvable dans le répertoire Sirene.'
    }
  } catch (error) {
    unitError = error instanceof Error ? error.message : 'Appel INSEE Sirene impossible.'
  }

  if (inpiUsername && inpiPassword) {
    try {
      const dirigeants = await fetchInpiDirigeants(siren, inpiUsername, inpiPassword)
      const formatted = formatDirigeants(dirigeants)
      if (formatted) facts.push({ fact_key: 'executives', value: formatted, source_label: 'INPI RNE' })
    } catch {
      // Best-effort : l'identité légale INSEE sort quand même sans dirigeants.
    }
  }

  if (facts.length <= 1 && unitError) return json({ error: unitError }, 502)

  const { error: insertError } = await supabase.from('account_firmographic_facts').insert(
    facts.map((fact) => ({
      organization_id: organizationId,
      company_id: companyId,
      fact_key: fact.fact_key,
      value: fact.value,
      source_type: 'api',
      source_id: siren,
      source_label: fact.source_label,
      source_url: sourceUrl,
      observed_at: observedAt,
      imported_at: observedAt,
      last_verified_at: observedAt,
      confidence: 100,
      inference_level: 'observed',
    })),
  )
  if (insertError) return json({ error: insertError.message }, 500)

  await supabase.from('companies').update({ siren }).eq('id', companyId).eq('organization_id', organizationId)

  return json({ ok: true, factsWritten: facts.length, siren })
})
