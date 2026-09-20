import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PersonDetailData } from './types'
import { V48Icon, formatDate } from './ui'

type Dimension = 'confiance' | 'satisfaction' | 'dynamique' | 'reciprocite' | 'fiabilite' | 'influence'
type Band = 'good' | 'mid' | 'low' | 'na'
type WeatherDimension = { id: Dimension; value: number | null; weight: number | null; comparison: number | null; trend: { delta: number; from: number; at: string } | null; measured: boolean }
type Proof = { type: string; period: string; text: string; source: string; band: Band }

const ORDER: Dimension[] = ['confiance', 'satisfaction', 'dynamique', 'reciprocite', 'fiabilite', 'influence']
const LABEL: Record<Dimension, string> = {
  confiance: 'Confiance', satisfaction: 'Satisfaction', dynamique: 'Dynamique',
  reciprocite: 'Réciprocité', fiabilite: 'Fiabilité', influence: 'Influence',
}
const WEIGHT: Record<Dimension, number | null> = {
  confiance: 25, satisfaction: 25, dynamique: 20, reciprocite: 20,
  // Fiabilité réemploie l'axe Ancrage (même poids, 10%, dans le score personne).
  // Influence n'entre pas dans le score : c'est l'autorité du rôle déclaré,
  // affichée à titre indicatif — pas de poids à afficher.
  fiabilite: 10, influence: null,
}
const METHOD: Record<Dimension, string> = {
  confiance: 'Signaux de confiance et engagements observés dans les échanges. Une absence de contenu analysé ne donne pas de note.',
  satisfaction: 'Retours positifs et points de friction identifiés dans le contenu des échanges.',
  dynamique: 'Rythme récent et engagement observé dans la relation, évalués par le moteur personne à partir des échanges disponibles.',
  reciprocite: 'Initiatives et réponses des deux côtés, avec une lecture adaptée au type de relation.',
  fiabilite: 'Continuité de la relation dans le temps (fréquence des échanges, régularité, diversité des canaux). Sans historique suffisant, ce chiffre démarre neutre à 50.',
  influence: 'Poids décisionnel du rôle déclaré pour cette personne (décideur, influenceur, utilisateur, filtre). Sans rôle renseigné, ce chiffre reste neutre à 50 — ce n’est pas un score mesuré dans les échanges.',
}
const ICON: Record<Dimension, ReactNode> = {
  confiance: <><path d="M12 3.5 4.5 7v5c0 4.6 3.2 8.1 7.5 9 4.3-.9 7.5-4.4 7.5-9V7z" /><path d="m9 12 2 2 4-4" /></>,
  satisfaction: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9" /><path d="M9.3 9.6h.01M14.7 9.6h.01" /></>,
  dynamique: <><path d="M3.5 17.5 9 11.5l3.5 3.5 7-7.5" /><path d="M15.5 7.5h4v4" /></>,
  reciprocite: <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" /><path d="M8.2 10.9l7-3.6M8.2 13.1l7 3.6" /></>,
  fiabilite: <><path d="M12 3.5 4.5 7v5c0 4.6 3.2 8.1 7.5 9 4.3-.9 7.5-4.4 7.5-9V7z" /><path d="M8 12h8M12 8v8" /></>,
  influence: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8.5" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>,
}
const COLOR: Record<Band, string> = { good: 'var(--sage)', mid: 'var(--amber)', low: 'var(--coral)', na: 'var(--t3)' }
// Une valeur non mesurée (baseline neutre 50) s'affiche en gris neutre, pas
// en couleur — sinon un 50 par défaut se lirait comme un vrai signal "mid".
const bandOf = (value: number | null, measured = true): Band => value === null || !measured ? 'na' : value >= 70 ? 'good' : value >= 50 ? 'mid' : 'low'
const signed = (value: number) => value > 0 ? `+${value}` : String(value)

function trendFor(data: PersonDetailData, id: Dimension, value: number | null, measured: boolean): WeatherDimension['trend'] {
  if (value === null || !measured || id === 'fiabilite' || id === 'influence') return null
  const history = data.relationship.dimensionHistory
  const latest = history.at(-1)
  if (!latest) return null
  const latestTime = new Date(latest.at).getTime()
  if (!Number.isFinite(latestTime)) return null
  const previous = [...history].reverse().find((row) => {
    const age = (latestTime - new Date(row.at).getTime()) / 86_400_000
    return age >= 25 && age <= 35 && row[id] !== null
  })
  const from = previous?.[id]
  return previous && typeof from === 'number' ? { delta: value - from, from, at: previous.at } : null
}

const MEASURED_FLAG: Record<Dimension, keyof PersonDetailData['relationship']['dimensions']> = {
  confiance: 'confianceMeasured', satisfaction: 'satisfactionMeasured', dynamique: 'engagementMeasured',
  reciprocite: 'reciprociteMeasured', fiabilite: 'ancrageMeasured', influence: 'influenceMeasured',
}

function buildDimensions(data: PersonDetailData): Record<Dimension, WeatherDimension> {
  const values = data.relationship.weatherDimensions
  const dims = data.relationship.dimensions
  return Object.fromEntries(ORDER.map((id) => {
    const measured = Boolean(dims[MEASURED_FLAG[id]])
    return [id, { id, value: values[id], weight: WEIGHT[id], comparison: null, measured, trend: trendFor(data, id, values[id], measured) }]
  })) as Record<Dimension, WeatherDimension>
}

function Tile({ dim, active, onSelect }: { dim: WeatherDimension; active: boolean; onSelect: () => void }) {
  const band = bandOf(dim.value, dim.measured)
  const trend = dim.trend
  return <button type="button" className={`pw-t ${active ? 'on' : ''} ${!dim.measured ? 'na' : ''}`} aria-pressed={active} onClick={onSelect}>
    <span className="pw-t-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[dim.id]}</svg></span>
    <span className="pw-t-nm">{LABEL[dim.id]}</span>
    <span className="pw-t-score"><strong style={{ color: COLOR[band] }}>{dim.value ?? '—'}</strong><span className="pw-t-w" title="Poids dans le score personne actuel">{dim.weight === null ? '—' : `${dim.weight}%`}</span></span>
    <span className="pw-t-g"><i style={{ width: `${dim.value ?? 0}%`, background: COLOR[band] }} />{dim.value !== null && <b style={{ left: `${dim.value}%`, borderColor: COLOR[band] }} />}{dim.comparison !== null && <em style={{ left: `${dim.comparison}%` }} />}</span>
    <span className="pw-t-dl">{!dim.measured ? 'Pas encore mesuré · neutre' : trend ? trend.delta === 0 ? 'stable' : `${signed(trend.delta)} sur 30 j` : 'Évolution indisponible'}{dim.comparison !== null ? ` · vous ${dim.comparison}` : ''}</span>
  </button>
}

function reading(dim: WeatherDimension): string {
  if (!dim.measured) return 'Analyse pas encore effectuée pour ce contact — valeur temporairement neutre (50).'
  const trend = dim.trend
  if (trend && trend.delta <= -5) return `${Math.abs(trend.delta)} points perdus depuis le ${formatDate(trend.at)}. ${LABEL[dim.id]} en recul dans les données observées.`
  if (trend && trend.delta >= 5) return `${trend.delta} points gagnés depuis le ${formatDate(trend.at)}. ${LABEL[dim.id]} en progression dans les données observées.`
  const band = bandOf(dim.value)
  const phrases: Record<Dimension, Record<Exclude<Band, 'na'>, string>> = {
    confiance: { good: 'Les signaux de confiance observés sont favorables.', mid: 'La confiance reste à consolider dans les échanges observés.', low: 'Les signaux de confiance observés appellent de l’attention.' },
    satisfaction: { good: 'Les échanges analysés montrent une satisfaction favorable.', mid: 'La satisfaction observée est contrastée.', low: 'Des points de friction pèsent sur la satisfaction observée.' },
    dynamique: { good: 'Le rythme de la relation est soutenu par rapport à son historique.', mid: 'La relation conserve un rythme intermédiaire.', low: 'Le rythme de la relation est en retrait par rapport à son historique.' },
    reciprocite: { good: 'Les deux parties entretiennent la relation.', mid: 'L’équilibre des initiatives reste partiel.', low: 'Les initiatives sont déséquilibrées dans les échanges observés.' },
    fiabilite: { good: 'Les échanges sont réguliers et diversifiés dans le temps.', mid: 'La continuité de la relation reste à confirmer dans la durée.', low: 'Les échanges sont peu réguliers ou se sont interrompus.' },
    influence: { good: 'Cette personne occupe un rôle à forte autorité décisionnelle.', mid: 'Le poids décisionnel de cette personne est intermédiaire ou non confirmé.', low: 'Cette personne n’a pas, à ce stade, un rôle décisionnel identifié.' },
  }
  const body = phrases[dim.id][band === 'na' ? 'mid' : band]
  return trend && trend.delta === 0 ? `${body} Score stable sur 30 jours.` : body
}

function proofsFor(data: PersonDetailData, dim: WeatherDimension): Proof[] {
  const result: Proof[] = []
  if (dim.trend && dim.value !== null) result.push({
    type: 'ANALYSE', period: '30 J',
    text: `Score ${dim.trend.from} le ${formatDate(dim.trend.at)}, ${dim.value} au dernier calcul.`,
    source: 'Historique du score', band: bandOf(dim.value),
  })
  const prefix: Partial<Record<Dimension, string>> = { confiance: 'C', satisfaction: 'S', dynamique: 'E', reciprocite: 'R' }
  const markerPrefix = prefix[dim.id]
  if (markerPrefix) for (const marker of data.relationship.markerEvidence.filter((item) => item.markerId.startsWith(markerPrefix)).slice(0, 3)) {
    result.push({ type: marker.source === 'Réunion' ? 'RÉUNION' : 'ANALYSE', period: formatDate(marker.observedAt), text: marker.text, source: marker.source, band: bandOf(dim.value) })
  }
  if (dim.id === 'confiance' || dim.id === 'satisfaction') {
    const evidence = data.relationship.dimensionEvidence[dim.id]
    const analyzedAt = data.behavior.updatedAt
    for (const item of evidence.slice(0, 3)) result.push({
      type: 'ANALYSE', period: analyzedAt ? `AU ${formatDate(analyzedAt)}` : 'DATE INCONNUE',
      text: item, source: 'Analyse Tohu', band: bandOf(dim.value),
    })
  }
  if (result.length === 0 && (dim.id === 'dynamique' || dim.id === 'reciprocite') && data.relationship.totalInteractions > 0) {
    result.push({ type: 'ÉCHANGES', period: data.relationship.lastInteractionAt ? `AU ${formatDate(data.relationship.lastInteractionAt)}` : 'DATE INCONNUE',
      text: `${data.relationship.emailInteractions} email${data.relationship.emailInteractions > 1 ? 's' : ''} et ${data.relationship.meetingInteractions} réunion${data.relationship.meetingInteractions > 1 ? 's' : ''} observés au total.`, source: 'Échanges connectés', band: bandOf(dim.value) })
  }
  return result
}

function ProofRow({ proof }: { proof: Proof }) {
  const sourceIcon = proof.source === 'Historique du score'
    ? <><path d="M4 19V5M4 19h16M7 14l4-4 3 2 5-6" /></>
    : ['échanges connectés', 'mail', 'gmail', 'outlook', 'microsoft'].includes(proof.source.toLowerCase())
      ? <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></>
      : proof.source === 'Réunion'
        ? <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v9l-5-3Z" /></>
      : <><circle cx="12" cy="12" r="8" /><path d="m9 12 2 2 4-4" /></>
  return <div className="pw-proof">
    <span className="pw-proof-dot" style={{ background: COLOR[proof.band] }} />
    <div className="pw-proof-main"><p className="pw-proof-meta">{proof.type} <span>· {proof.period}</span></p><p className="pw-proof-text">{proof.text}</p></div>
    <span className="pw-proof-source" title={proof.source} aria-label={proof.source}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{sourceIcon}</svg></span>
  </div>
}

export function PersonWeatherDetailSection({ data }: { data: PersonDetailData }) {
  const dimensions = buildDimensions(data)
  const [selected, setSelected] = useState<Dimension>('confiance')
  useEffect(() => { setSelected((current) => current && ORDER.includes(current) ? current : 'confiance') }, [data.person.id])
  const dim = dimensions[selected]
  const proofs = proofsFor(data, dim)
  return <section className="pw-sec">
    <div className="pw-sec-h"><span className="pw-sec-ic"><V48Icon name="pulse" /></span><p className="pw-sec-t">Météo de la relation</p></div>
    <div className="pw-tiles">{ORDER.map((id) => <Tile key={id} dim={dimensions[id]} active={selected === id} onSelect={() => setSelected(id)} />)}</div>
    <div className="pw-det">
      <div><p className="pw-det-q">{LABEL[selected]} · lecture</p><p className="pw-det-r">{reading(dim)}</p>
        <hr className="pw-det-sep" /><p className="pw-det-h">Comment on le calcule.</p><p className="pw-det-x">{METHOD[selected]}</p></div>
      <div><p className="pw-det-q">Preuves</p>{proofs.length ? <div className="pw-det-proofs">{proofs.map((proof, index) => <ProofRow key={`${proof.type}-${proof.period}-${index}`} proof={proof} />)}</div> : <p className="pw-det-x muted">Aucune preuve détaillée disponible pour cette dimension.</p>}</div>
    </div>
  </section>
}
