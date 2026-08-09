// Assemble les données réelles du digest hebdo pour une organisation, à partir des
// mêmes tables que le dashboard home. Défensif : chaque section peut être vide ; si
// rien de significatif, `significant=false` → l'appelant envoie la variante « vide ».
import type { DigestData } from '../_shared/email-templates/digest.ts'

const DAY = 86_400_000
const DAYS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const frDate = (iso: string | Date) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }
function relDay(iso: string): string {
  const d = new Date(iso); const diff = Date.now() - d.getTime()
  if (diff < 7 * DAY && diff >= 0) return DAYS_LONG[d.getUTCDay()]
  return `il y a ${Math.max(1, Math.round(diff / DAY))} j`
}
function cleanLabel(content: string): string {
  let s = String(content ?? '').replace(/^\s*nous\s*:\s*/i, '').replace(/\s*[—-]\s*échéance.*$/i, '').trim()
  if (s.length > 66) s = s.slice(0, 64).trimEnd() + '…'
  return s
}

export async function assembleDigest(supabase: any, organizationId: string, dashboardUrl: string): Promise<{ data: DigestData; significant: boolean }> {
  const now = new Date()
  const in7 = new Date(now.getTime() + 7 * DAY)
  const weekAgo = new Date(now.getTime() - 7 * DAY)
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY)

  const [{ data: companies }, { data: contacts }, { data: snaps }, { data: meetings }, { data: commitments }, { data: moments }, { data: signals }] = await Promise.all([
    supabase.from('companies').select('id,name').eq('organization_id', organizationId).eq('is_tracked', true),
    supabase.from('contacts').select('id,full_name,company_id').eq('organization_id', organizationId).is('merged_into_contact_id', null),
    supabase.from('account_relationship_score_snapshots').select('company_id,score,computed_at').eq('organization_id', organizationId).order('computed_at', { ascending: false }).limit(4000),
    supabase.from('meetings').select('id,title,starts_at,company_id,company').eq('organization_id', organizationId).gte('starts_at', now.toISOString()).lte('starts_at', in7.toISOString()).order('starts_at', { ascending: true }).limit(8),
    supabase.from('person_memory_entries').select('content,resolved_at,created_at,observed_at,contact_id').eq('organization_id', organizationId).eq('entry_type', 'commitment').limit(500),
    supabase.from('person_key_moments').select('title,impact,occurred_at,contact_id').eq('organization_id', organizationId).gte('occurred_at', weekAgo.toISOString()).order('occurred_at', { ascending: false }).limit(4),
    supabase.from('company_signals').select('family,title,summary,source,observed_at,company_id').eq('organization_id', organizationId).gte('observed_at', twoWeeksAgo.toISOString()).order('observed_at', { ascending: false }).limit(8),
  ])

  const companyName = new Map<string, string>((companies ?? []).map((c: any) => [c.id, c.name]))
  const contactById = new Map<string, any>((contacts ?? []).map((c: any) => [c.id, c]))
  const accountFor = (contactId: string) => { const c = contactById.get(contactId); return c ? ((c.company_id && companyName.get(c.company_id)) || c.full_name) : null }

  // Scores : dernier + référence ~7 j → delta par compte suivi ; NPS = moyenne.
  const byCompany = new Map<string, Array<{ score: number; at: number }>>()
  for (const s of (snaps ?? [])) {
    const cid = s.company_id; if (!cid || !companyName.has(cid)) continue
    const arr = byCompany.get(cid) ?? []; arr.push({ score: Number(s.score), at: new Date(s.computed_at).getTime() }); byCompany.set(cid, arr)
  }
  const accountDeltas: Array<{ name: string; score: number; delta: number }> = []
  let sumLatest = 0, sumBaseline = 0, nScored = 0
  for (const [cid, arr] of byCompany) {
    const latest = arr[0].score
    const baseline = (arr.find((x) => x.at <= weekAgo.getTime()) ?? arr[arr.length - 1]).score
    accountDeltas.push({ name: companyName.get(cid)!, score: Math.round(latest), delta: Math.round(latest - baseline) })
    sumLatest += latest; sumBaseline += baseline; nScored++
  }
  const nps = { value: nScored ? Math.round(sumLatest / nScored) : 0, delta: nScored ? Math.round((sumLatest - sumBaseline) / nScored) : 0, weeks: 12, accounts: nScored }
  const warming = accountDeltas.filter((a) => a.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3).map((a) => ({ name: a.name, note: 'en progression', score: a.score, delta: a.delta }))
  const declining = accountDeltas.filter((a) => a.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2).map((a) => ({ name: a.name, note: 'en recul', score: a.score, delta: Math.abs(a.delta) }))

  // Réunions de la semaine.
  const weekAhead = (meetings ?? []).map((m: any) => {
    const cname = m.company_id ? companyName.get(m.company_id) : null
    const d = new Date(m.starts_at)
    return { day: DAYS[d.getUTCDay()], time: `${d.getUTCHours()} h`, who: cname ?? (m.company ?? m.title ?? 'Réunion'), sub: m.title ?? '', badge: cname ? 'à préparer' : 'hors périmètre', badgeKind: (cname ? 'ready' : 'out') as 'ready' | 'out' }
  })

  // Engagements : glissés (ouverts > 14 j), en cours (ouverts récents), validés (résolus < 7 j).
  const slipped: Array<{ account: string; label: string; since: string }> = []
  const inProgress: string[] = []
  const validated: string[] = []
  for (const e of (commitments ?? [])) {
    const created = new Date(e.observed_at ?? e.created_at)
    if (e.resolved_at) { if (new Date(e.resolved_at) >= weekAgo) validated.push(cleanLabel(e.content)); continue }
    if (created.getTime() < twoWeeksAgo.getTime()) slipped.push({ account: accountFor(e.contact_id) ?? '—', label: cleanLabel(e.content), since: `promis le ${frDate(created)}` })
    else inProgress.push(cleanLabel(e.content))
  }

  // Temps forts (moments de la semaine).
  const highlights = (moments ?? []).map((m: any) => {
    const who = accountFor(m.contact_id)
    return { kind: (m.impact === 'friction' ? 'warn' : 'ok') as 'ok' | 'warn', text: `${who ? `<strong>${esc(who)}</strong> &mdash; ` : ''}${esc(m.title)}`, when: relDay(m.occurred_at) }
  })

  // Veille externe (signaux entreprises sur comptes suivis).
  const FAMILY_TAG: Record<string, { tag: string; color: 'red' | 'green' | 'blue' }> = {
    mobility: { tag: 'Mobilité', color: 'red' }, funding: { tag: 'Croissance', color: 'green' }, growth: { tag: 'Croissance', color: 'green' },
    market: { tag: 'Marché', color: 'blue' }, risk: { tag: 'Risque', color: 'red' },
  }
  const watch = (signals ?? []).filter((s: any) => s.company_id && companyName.has(s.company_id)).slice(0, 3).map((s: any) => {
    const fam = FAMILY_TAG[String(s.family ?? '').toLowerCase()] ?? { tag: (s.family ? String(s.family) : 'Signal'), color: 'blue' as const }
    return { tag: fam.tag, tagColor: fam.color, text: `<strong>${esc(companyName.get(s.company_id))}</strong> — ${esc(s.title ?? s.summary ?? '')}`, source: String(s.source ?? 'veille') }
  })

  const significant = weekAhead.length > 0 || warming.length > 0 || declining.length > 0 || slipped.length > 0 || highlights.length > 0 || watch.length > 0
  const periodLabel = `Semaine du ${frDate(now)}`
  const headline = significant
    ? (declining.length ? `${warming.length || 'Des'} compte${warming.length > 1 ? 's' : ''} se r&eacute;chauffent.<br/>${declining.length} d&eacute;croche${declining.length > 1 ? 'nt' : ''}.` : 'Ta semaine relationnelle.')
    : 'Semaine calme.'

  const openTotal = slipped.length + inProgress.length
  const movers = warming.length + declining.length
  const data: DigestData = {
    subject: significant
      ? `Ta semaine · ${movers ? `${movers} compte(s) en mouvement` : `${weekAhead.length} réunion(s)`}, ${openTotal} engagement(s) ouverts`
      : 'Ta semaine · rien de significatif',
    preheader: significant
      ? `${warming.length} en hausse, ${declining.length} en recul · ${slipped.length} engagement(s) glissé(s).`
      : 'Aucun mouvement ne justifie ton attention cette semaine. On te le dit plutôt que d’inventer.',
    periodLabel, headline, dashboardUrl,
    weekAhead, weekAheadNote: weekAhead.some((m) => m.badgeKind === 'ready') ? 'Les antisèches arriveront la veille à 18 h, sans rien demander.' : 'Aucune réunion à préparer cette semaine.',
    nps, warming, declining,
    engagements: { slipped, slippedDelta: 0, inProgress, inProgressNote: inProgress.length ? 'à suivre cette semaine' : '', validated, validatedDelta: validated.length, openTotal },
    highlights, watch, watchNote: watch.length ? 'Retenus : ceux qui touchent un compte où tu as une relation active.' : '',
    cadenceNote: 'Chaque lundi à 8 h.',
    computedNote: `Calculé le ${frDate(now)} · sources : Gmail, Read AI, veille`,
  }
  return { data, significant }
}
