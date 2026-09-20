import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { scoreWindow, sourceTypeLabel } from './mapping'
import type { PersonApproachScenario, PersonCognitiveProfile, PersonDetailData, PersonHistoryEvent, PersonMemoryEntry, PersonPrimaryAxis, PersonRecommendation, PersonScorePoint, PrimaryAxisId } from './types'
import { CareerSection, HistoryCard, MemoryCard, SignalsCard } from './sections2'
import type { CareerHook } from './sections2'
import { dismissPersonMemoryEntry, fetchRelationshipNarrative, resolvePersonMemoryEntry, updatePersonRecommendationStatus } from './service'
import { isBehavioralSignal, signalTypeLabel } from '../services/signal-labels'
import { V48Icon, confidenceLevel, formatDate, formatMonth, relativeDate, renderEmphasis, scoreTone, useBusy, useToast } from './ui'
import { ContactAvatar } from '../components/ContactAvatar'
import { PersonWeatherDetailSection } from './PersonWeatherDetail'

type ViewProps = {
  data: PersonDetailData
  userId: string
  refresh: () => Promise<void>
  manualSyncAction?: ReactNode
  /** Remplace le texte état-vide générique (pensé pour une fiche Personne,
   * « Synchronise les emails et les réunions de cette personne ») quand ce
   * composant est réutilisé pour « Mon profil » — voir ProfilePage, qui
   * distingue source non connectée / analyse en cours / pas assez de matière. */
  emptyStateOverride?: ReactNode
}


function EmptyState({ children }: { children: ReactNode }) {
  return <div className="v48-empty"><span>◇</span><p>{children}</p></div>
}

type AxisTier = 'legere' | 'moyenne' | 'forte'

function axisTier(predominancePct: number | null): AxisTier {
  const value = predominancePct ?? 0
  return value < 40 ? 'legere' : value < 60 ? 'moyenne' : 'forte'
}

// Rouge < 40 % (signal faible/ambigu), orange 40-60 % (inchangé), vert > 60 %
// (signal net et confirmé) — sur demande explicite, à l'inverse de l'intuition
// « petite variation = anodin (vert) » : ici une faible prédominance est le cas
// à surveiller, une forte prédominance est le cas rassurant.
const AXIS_TIER_COLOR: Record<AxisTier, string> = { legere: '#2EA86A', moyenne: '#C97A20', forte: '#D94F63' }
const AXIS_TIER_WORD: Record<AxisTier, string> = { legere: 'légèrement', moyenne: 'nettement', forte: 'fortement' }

const AXIS_HINT: Record<PrimaryAxisId, string> = {
  rythme: 'Longueur des tours de parole et vitesse d’enchaînement, mesurées sur les échanges.',
  argumentation: 'Part d’énoncés chiffrés ou sourcés dans ses interventions.',
  engagement: 'Fréquence des promesses formulées explicitement, avec un objet et une échéance.',
  registre: 'Niveau de formalité du vocabulaire et des formules d’adresse.',
  tonalite: 'Marques d’encouragement, de reconnaissance et d’attention à l’interlocuteur.',
  espace_parole: 'Part du temps de parole occupée sur les échanges enregistrés.',
}


const RADAR_CX = 330
const RADAR_CY = 262
const RADAR_R = 128
type AxisIndex = 0 | 1 | 2 | 3 | 4 | 5
const RADAR_ANGLES: Record<AxisIndex, number> = {
  0: -Math.PI / 2, 1: -Math.PI / 2 + Math.PI / 3, 2: -Math.PI / 2 + 2 * Math.PI / 3,
  3: -Math.PI / 2 + Math.PI, 4: -Math.PI / 2 + 4 * Math.PI / 3, 5: -Math.PI / 2 + 5 * Math.PI / 3,
}

function radarPoint(index: AxisIndex, valuePct: number): [number, number] {
  const r = RADAR_R * Math.max(0, Math.min(100, valuePct)) / 100
  return [RADAR_CX + Math.cos(RADAR_ANGLES[index]) * r, RADAR_CY + Math.sin(RADAR_ANGLES[index]) * r]
}

const AXIS_LABEL_LAYOUT: Record<AxisIndex, { anchor: 'start' | 'middle' | 'end'; x: number; y: number }> = {
  0: { anchor: 'middle', x: 330, y: 72 },
  1: { anchor: 'start', x: 486, y: 184 },
  2: { anchor: 'start', x: 486, y: 316 },
  3: { anchor: 'middle', x: 330, y: 424 },
  4: { anchor: 'end', x: 174, y: 316 },
  5: { anchor: 'end', x: 174, y: 184 },
}

function toPercent(x: number, y: number): { left: string; top: string } {
  return { left: `${((x - 0) / 660) * 100}%`, top: `${((y - 50) / 430) * 100}%` }
}

type Tip = { left: number; top: number; above: boolean; content: ReactNode }

/** Icône de connecteur/source pour une preuve de trait — dérivée du même label
 *  humain que le reste de la fiche (sourceTypeLabel), pas d'une liste dupliquée.
 *  Retombe sur une icône générique tant qu'aucun logo dédié n'est branché : la
 *  structure (une icône par label réel) est prête à recevoir les vrais logos. */
const EVIDENCE_SOURCE_ICON: Record<string, ReactNode> = {
  Gmail: <><rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2" /><path d="M3.9 7l8.1 6 8.1-6" /></>,
  Emails: <><rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2" /><path d="M3.9 7l8.1 6 8.1-6" /></>,
  Outlook: <><rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2" /><path d="M3.9 7l8.1 6 8.1-6" /></>,
  Transcription: <><rect x="3" y="6.5" width="13" height="11" rx="2" /><path d="m16 10.5 5-3v9l-5-3Z" /></>,
  Slack: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  LinkedIn: <><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" /><path d="M8 10.6v6" /><circle cx="8" cy="7.6" r="1.1" fill="currentColor" /><path d="M12 16.6v-3.4a2.2 2.2 0 0 1 4.4 0v3.4M12 16.6v-6" /></>,
  'Note interne': <><path d="M6 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M14 4v5h5" /></>,
  'Veille IA': <><circle cx="12" cy="12" r="8.4" /><path d="M3.6 12h16.8" /><path d="M12 3.6a13 13 0 0 1 0 16.8a13 13 0 0 1 0-16.8" /></>,
  'Recherche web': <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></>,
}
const EVIDENCE_SOURCE_ICON_FALLBACK = <circle cx="12" cy="12" r="8.4" />
function SourceBadge({ sourceType }: { sourceType: string }) {
  const label = sourceTypeLabel(sourceType)
  return <span className="ev-src" title={label}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{EVIDENCE_SOURCE_ICON[label] ?? EVIDENCE_SOURCE_ICON_FALLBACK}</svg>
    <span className="sr-only">{label}</span>
  </span>
}

/** Popover « preuves » d'un trait : reste ouvert quand la souris passe du
 *  déclencheur vers le contenu (petit délai de fermeture), et bascule en
 *  tap/click sur tactile (pas de hover) — fermeture au tap extérieur. */
function EvidencePopover({ label, evidence, sourceTypes }: { label: string; evidence: string[]; sourceTypes: string[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const scheduleClose = () => { clearCloseTimer(); closeTimer.current = window.setTimeout(() => setOpen(false), 180) }
  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 300
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
    setPos({ left, top: rect.top > 220 ? rect.top - 10 : rect.bottom + 10, above: rect.top > 220 })
  }
  const openNow = () => { clearCloseTimer(); place(); setOpen(true) }

  useEffect(() => {
    if (!open) return
    const reposition = () => place()
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('click', onDocClick)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('click', onDocClick)
    }
  }, [open])
  useEffect(() => () => clearCloseTimer(), [])

  // 2 à 5 preuves maximum dans le popover — lecture immédiate, pas une liste
  // exhaustive (le reste du profil détaillé reste accessible par ailleurs).
  const shortEvidence = evidence.slice(0, 5)
  const uniqueSources = Array.from(new Set(sourceTypes))

  return <span className="ev-anchor">
    <button
      type="button"
      ref={btnRef}
      className="pv"
      aria-expanded={open}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onFocus={openNow}
      onBlur={scheduleClose}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); if (!open) place() }}
    >preuves</button>
    {open && pos && createPortal(
      <div
        ref={popRef}
        className="ev-pop"
        role="tooltip"
        style={{ left: pos.left, top: pos.top, transform: pos.above ? 'translateY(-100%)' : 'none' }}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
      >
        <p className="ev-pop-t">{label} · preuves</p>
        {shortEvidence.length > 0
          ? <ul className="ev-pop-l">{shortEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
          : <p className="ev-pop-empty">Aucune preuve détaillée disponible.</p>}
        {uniqueSources.length > 0 && <div className="ev-pop-src">
          {uniqueSources.map((source) => <SourceBadge key={source} sourceType={source} />)}
        </div>}
      </div>,
      document.body,
    )}
  </span>
}

function BehaviorRadar({ axes, onShowTip, onHideTip }: { axes: PersonPrimaryAxis[]; onShowTip: (event: React.SyntheticEvent, content: ReactNode) => void; onHideTip: () => void }) {
  const entries = axes.slice(0, 6).map((axis, position) => {
    const index = position as AxisIndex
    const layout = AXIS_LABEL_LAYOUT[index]
    const insufficient = axis.status === 'insufficient'
    const tier = axisTier(axis.predominancePct)
    const color = insufficient ? '#8B84A3' : AXIS_TIER_COLOR[tier]
    const activePoleLabel = axis.activePole === 'left' ? axis.poleLeft : axis.activePole === 'right' ? axis.poleRight : null
    const predominance = axis.predominancePct ?? 0
    const marginPct = (axis.marginPts ?? 0) * 2
    return {
      axis, index, layout, insufficient, color,
      activePoleLabel,
      point: radarPoint(index, predominance),
      bandOuter: radarPoint(index, Math.min(100, predominance + marginPct)),
      bandInner: radarPoint(index, Math.max(0, predominance - marginPct)),
    }
  })
  const ring = (pct: number) => entries.map(({ index }) => radarPoint(index, pct).join(',')).join(' ')
  const bandPath = `M ${entries.map((entry) => entry.bandOuter.join(' ')).join(' L ')} Z M ${entries.map((entry) => entry.bandInner.join(' ')).join(' L ')} Z`

  return <div className="rad-wrap"><svg className="rad" viewBox="0 50 660 430" role="img" aria-label={entries.map(({ axis }) => `${axis.label} ${axis.predominancePct ?? 0} pour cent`).join(', ')}>
    {[25, 75, 100].map((value) => <polygon key={value} points={ring(value)} fill="none" stroke="var(--grid)" strokeWidth="1" />)}
    <polygon points={ring(50)} fill="none" stroke="var(--vl)" strokeWidth="1.3" strokeDasharray="4 4" />
    {entries.map(({ axis, index }) => {
      const [x, y] = radarPoint(index, 100)
      return <line key={axis.id} x1={RADAR_CX} y1={RADAR_CY} x2={x} y2={y} stroke="var(--grid)" strokeWidth="1" />
    })}
    <path d={bandPath} fillRule="evenodd" fill="rgba(110,80,200,.13)" />
    <polygon points={entries.map((entry) => entry.bandOuter.join(',')).join(' ')} fill="none" stroke="var(--vl)" strokeWidth="1.1" />
    <polygon points={entries.map((entry) => entry.bandInner.join(',')).join(' ')} fill="none" stroke="var(--vl)" strokeWidth="1.1" />
    <polygon points={entries.map((entry) => entry.point.join(',')).join(' ')} fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinejoin="round" />
    {entries.map(({ axis, point: [x, y], color }) => <circle key={axis.id} cx={x} cy={y} r="4" fill={color} stroke="#fff" strokeWidth="1.4" />)}
    {entries.map(({ axis, layout, insufficient, color, activePoleLabel }) => <g key={axis.id}>
      <text x={layout.x} y={layout.y} textAnchor={layout.anchor} fontFamily="var(--mono)" fontSize="9.5" letterSpacing="1.3" fill="#9082B8">{axis.label.toUpperCase()}</text>
      <text x={layout.x} y={layout.y + 22} textAnchor={layout.anchor} fontFamily="var(--font)" fontWeight="800" fontSize="18" fill={color}>
        {insufficient ? 'À confirmer' : `+${axis.predominancePct ?? 0} % ${activePoleLabel}`}
      </text>
      <text x={layout.x} y={layout.y + 38} textAnchor={layout.anchor} fontFamily="var(--mono)" fontSize="9">
        <tspan fontFamily="var(--font)" fontWeight={axis.activePole === 'left' ? 800 : 400} fontSize={axis.activePole === 'left' ? 11 : 9} fill={axis.activePole === 'left' ? color : '#8B84A3'}>{axis.poleLeft}</tspan>
        <tspan fill="#B9B2CC"> ‹› </tspan>
        <tspan fontFamily="var(--font)" fontWeight={axis.activePole === 'right' ? 800 : 400} fontSize={axis.activePole === 'right' ? 11 : 9} fill={axis.activePole === 'right' ? color : '#8B84A3'}>{axis.poleRight}</tspan>
      </text>
    </g>)}
    </svg>
    {entries.map(({ axis, layout, insufficient, activePoleLabel }) => {
      // « i » collé à la valeur (« +20 % Rapide »), au niveau de cette ligne : à
      // DROITE de la valeur pour rythme/registre (centre) + argumentation/engagement
      // (côté droit), à GAUCHE pour tonalité/espace de parole (côté gauche).
      const valueText = insufficient ? 'À confirmer' : `+${axis.predominancePct ?? 0} % ${activePoleLabel ?? ''}`
      const valueW = valueText.length * 9.6 // largeur approx. de la valeur en unités SVG (police 18)
      const btnW = 32
      const ix = layout.anchor === 'start' ? layout.x + valueW + 20
        : layout.anchor === 'end' ? layout.x - valueW - 12 - btnW
          : layout.x + valueW / 2 + 32
      const pos = toPercent(ix, layout.y + (layout.anchor === 'end' ? 8 : 13))
      const trendPhrase = axis.trendLabel === 'rising' ? `+${Math.abs(axis.trendPts ?? 0)} pts sur 30 jours.`
        : axis.trendLabel === 'declining' ? `−${Math.abs(axis.trendPts ?? 0)} pts sur 30 jours.`
          : axis.trendLabel === 'stable' ? 'Stable sur 30 jours.' : null
      const tipContent = <>
        <p className="v48-tipx-t">{axis.label}</p>
        <p className="v48-tipx-d">{AXIS_HINT[axis.id]}</p>
        <p className="v48-tipx-p">{insufficient
          ? 'Pas encore assez d’échanges attribuables pour observer cet axe.'
          : <>+{axis.predominancePct}&nbsp;% vers <b>{activePoleLabel}</b> — écart à la moyenne, brut {axis.rawScore}/100, marge ±{axis.marginPts ?? 0} pts. {trendPhrase}</>}</p>
      </>
      return <button
        key={axis.id}
        type="button"
        className="rdi"
        style={{ position: 'absolute', left: pos.left, top: pos.top }}
        onMouseEnter={(event) => onShowTip(event, tipContent)}
        onFocus={(event) => onShowTip(event, tipContent)}
        onMouseLeave={onHideTip}
        onBlur={onHideTip}
      >i</button>
    })}
  </div>
}

function quadrantInfo(assertiveness: number | null, warmth: number | null): { name: string; color: string; assertiveLabel: string; warmthLabel: string; dotX: number; dotY: number } | null {
  if (assertiveness === null || warmth === null) return null
  const assertive = assertiveness >= 50
  const warm = warmth >= 50
  const name = assertive ? (warm ? 'Influent' : 'Dominant') : (warm ? 'Stable' : 'Analytique')
  const color = { Influent: '#C97A20', Dominant: '#6E50C8', Stable: '#2EA86A', Analytique: '#2896A8' }[name]
  const assertivePct = Math.round(Math.abs(assertiveness - 50) * 2)
  const warmthPct = Math.round(Math.abs(warmth - 50) * 2)
  return {
    name,
    color,
    assertiveLabel: `${assertive ? 'assertif' : 'conciliant'} +${assertivePct} %`,
    warmthLabel: `${warm ? 'chaleureux' : 'distant'} +${warmthPct} %`,
    dotX: 50 + ((warmth - 50) / 50) * 44,
    dotY: 50 - ((assertiveness - 50) / 50) * 44,
  }
}

function QuadrantWidget({ data }: { data: PersonDetailData }) {
  const cognitive = data.behavior.cognitiveProfile
  const quadrant = quadrantInfo(cognitive.interpersonal.assertiveness.score, cognitive.interpersonal.warmth.score)
  const postureText = cognitive.posture.observation
    || (cognitive.interpersonal.assertiveness.observation && cognitive.interpersonal.warmth.observation
      ? `${cognitive.interpersonal.assertiveness.observation} ${cognitive.interpersonal.warmth.observation}`
      : cognitive.interpersonal.assertiveness.observation || cognitive.interpersonal.warmth.observation)

  return <div className="cq" style={{ '--c': quadrant?.color ?? '#8B84A3' } as React.CSSProperties}>
    <div className="cq-b">
      <svg className="mq" viewBox="0 0 100 100" role="img" aria-label={`Cadran interpersonnel : ${quadrant?.name ?? 'à confirmer'}`}>
        <path d="M 50 50 L 50 6 A 44 44 0 0 0 6 50 Z" fill="#F7F5FD" />
        <path d="M 50 50 L 50 6 A 44 44 0 0 1 94 50 Z" fill="#FBF1E2" />
        <path d="M 50 50 L 6 50 A 44 44 0 0 0 50 94 Z" fill="#F4FAFB" />
        <path d="M 50 50 L 94 50 A 44 44 0 0 1 50 94 Z" fill="#F5FBF8" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--grid)" strokeWidth="1" />
        <circle cx="50" cy="50" r="22" fill="none" stroke="var(--vl)" strokeWidth="1" strokeDasharray="2 4" />
        <line x1="50" y1="6" x2="50" y2="94" stroke="var(--grid)" strokeWidth="1" />
        <line x1="6" y1="50" x2="94" y2="50" stroke="var(--grid)" strokeWidth="1" />
        {quadrant && <circle cx={quadrant.dotX} cy={quadrant.dotY} r="5.6" fill={quadrant.color} stroke="#fff" strokeWidth="2" />}
      </svg>
      <div className="cq-c">
        <div className="cq-h">
          <p className="cq-q"><i />{quadrant?.name ?? 'À confirmer'}</p>
          {quadrant && <p className="cq-v">{quadrant.assertiveLabel}<span>·</span>{quadrant.warmthLabel}</p>}
        </div>
        <p className="cq-r">{postureText || 'Le profil est encore en construction. Tohu attend davantage d’échanges observables avant de caractériser sa posture.'}</p>
      </div>
    </div>
  </div>
}

/**
 * À faire / À éviter CONTEXTUELS, exclusivement déduits de l'analyse comportementale
 * (`approach_guidance`). Un scénario par page (« Avant un rendez-vous », « Pour obtenir
 * une décision »…). Aucun repli générique : sans analyse, on n'affiche rien de faux.
 */
function DoDontPager({ guidance }: { guidance: PersonApproachScenario[] }) {
  const [page, setPage] = useState(0)
  const total = guidance.length
  if (!total) return null
  const current = guidance[Math.min(page, total - 1)]!
  return <>
    <div className="dd-ctx"><span className="dd-ctx-t">{current.context}</span>{current.summary && <p className="dd-ctx-s">{current.summary}</p>}</div>
    <div className="dd">
      <div><h4 className="y">✓ À faire</h4><ul>{current.do.map((text, index) => <li key={`do-${index}`}><i className="li-i ok" />{text}</li>)}</ul></div>
      <div><h4 className="n">✕ À éviter</h4><ul>{current.dont.map((text, index) => <li key={`avoid-${index}`}><i className="li-i no" />{text}</li>)}</ul></div>
    </div>
    {total > 1 && <div className="mvp">
      <button type="button" className="mvp-b" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Précédent</button>
      <span className="mvp-i">posture {Math.min(page, total - 1) + 1} sur {total}</span>
      <button type="button" className="mvp-b" disabled={page >= total - 1} onClick={() => setPage((value) => Math.min(total - 1, value + 1))}>Suivant →</button>
    </div>}
  </>
}

/** Carte unifiée « Posture à adopter » : synthèse opérationnelle + règles do/don't
 *  déduites de l'analyse comportementale (moteur v3+, cognitive.approachGuidance),
 *  et les traits dominants du profil (cognitive.primaryAxes) en colonne latérale.
 *  Rien n'est ici inventé : si le moteur n'a rien produit, la carte reste sobre
 *  plutôt que d'afficher un gabarit générique. */
function PostureCard({ data, cognitive }: { data: PersonDetailData; cognitive: PersonCognitiveProfile }) {
  const scenario = cognitive.approachGuidance[0] ?? null
  const synthesis = scenario?.summary || cognitive.posture.observation || null
  // Un second segment n'est affiché que s'il apporte une information distincte
  // du résumé principal (évite de répéter deux fois la même phrase du moteur).
  const extra = scenario?.summary && cognitive.posture.observation && cognitive.posture.observation !== scenario.summary
    ? cognitive.posture.observation
    : null
  // Lecture immédiate : 3 pills maximum, et au plus 1 « à éviter » accentuée —
  // pas deux rangées complètes de do/don't. Les don't restants ne sont pas
  // perdus (visibles dans le détail du profil plus bas), seulement pas mis en
  // avant ici.
  const maxRules = 3
  const doSlots = scenario?.dont.length ? maxRules - 1 : maxRules
  const rules = scenario ? [
    ...scenario.do.slice(0, doSlots).map((text) => ({ text, tone: 'do' as const })),
    ...(scenario.dont.length ? [{ text: scenario.dont[0]!, tone: 'dont' as const }] : []),
  ] : []
  const dominant = cognitive.primaryAxes
    .filter((axis) => axis.status !== 'insufficient' && axis.activePole)
    .slice()
    .sort((a, b) => (b.predominancePct ?? 0) - (a.predominancePct ?? 0))
    .slice(0, 3)
  const analyzed = data.behavior.analyzedInteractions
  const confidence = confidenceLevel(cognitive.posture.confidence)

  return <article className="posture-card">
    <div className="posture-main">
      <p className="posture-label">Posture à adopter{data.behavior.updatedAt && <span className="posture-date"> · {formatDate(data.behavior.updatedAt)}</span>}</p>
      {synthesis
        ? <div className="posture-synthesis">
          <p>{renderEmphasis(synthesis)}</p>
          {extra && <p>{renderEmphasis(extra)}</p>}
        </div>
        : <p className="posture-synthesis empty">Le profil est encore en construction. Tohu attend davantage d’échanges observables avant de recommander une posture.</p>}
      {rules.length > 0 && <div className="posture-rules">
        {rules.map((rule, index) => <span key={index} className={`posture-chip ${rule.tone}`}>{rule.text}</span>)}
      </div>}
    </div>
    {dominant.length > 0 && <div className="posture-side">
      <p className="posture-side-h">Ce qui domine</p>
      <div className="posture-traits">
        {dominant.map((axis) => {
          const label = axis.activePole === 'left' ? axis.poleLeft : axis.poleRight
          return <p key={axis.id} className="posture-trait">
            <span className="posture-trait-score">+{axis.predominancePct}</span>{' '}
            <b>{label}</b>{axis.observation && <> — {axis.observation}</>}
          </p>
        })}
      </div>
      {analyzed > 0 && <p className="posture-side-foot">
        {confidence && <>Confiance de l’analyse : {confidence} · </>}
        {analyzed} échange{analyzed > 1 ? 's' : ''} analysé{analyzed > 1 ? 's' : ''}
      </p>}
    </div>}
  </article>
}

export function V48PersonProfileView({ data, manualSyncAction, emptyStateOverride }: ViewProps) {
  const cognitive = data.behavior.cognitiveProfile
  const primaryAxes = cognitive.primaryAxes
  const observedPrimary = primaryAxes.filter((axis) => axis.status !== 'insufficient')
  const evidenceThresholdReached = data.behavior.analyzedInteractions >= data.behavior.profileMinimumInteractions
  const hasProfile = evidenceThresholdReached && observedPrimary.length > 0
  const emerging = hasProfile && data.behavior.analyzedInteractions < data.behavior.minimumInteractions

  const [tip, setTip] = useState<Tip | null>(null)
  // Sélecteur de source du radar (P6.3) : proposé seulement si une analyse par
  // source a produit au moins un axe observé (mail et/ou réunion).
  const [radarSource, setRadarSource] = useState<'all' | 'email' | 'meeting'>('all')
  const bySource = cognitive.primaryAxesBySource
  const hasSourceSplit = bySource.email.some((axis) => axis.status !== 'insufficient') || bySource.meeting.some((axis) => axis.status !== 'insufficient')
  const radarAxes = radarSource === 'email' ? bySource.email : radarSource === 'meeting' ? bySource.meeting : primaryAxes
  const showTip = (event: React.SyntheticEvent, content: ReactNode) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const width = 288
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 8)
    const above = rect.top > 180
    setTip({ left, top: above ? rect.top - 10 : rect.bottom + 10, above, content })
  }
  const hideTip = () => setTip(null)

  return <div className="v48-person-profile">
    <PostureCard data={data} cognitive={cognitive} />

    <section className="sec bhv">
      <div className="sec-h">
        <span className="sec-ic"><V48Icon name="profile" /></span><p className="sec-t">Profil comportemental</p>
        <span className="cnt"><b>{observedPrimary.length}</b> dimensions · déduites de {data.behavior.analyzedInteractions} échange{data.behavior.analyzedInteractions > 1 ? 's' : ''}</span>
      </div>
      <div className="sec-b bhv-b">
        {!hasProfile
          ? <div style={{ padding: '4px 20px 20px' }}>
            <EmptyState>{evidenceThresholdReached
              ? cognitive.schemaVersion < 3
                ? `${data.behavior.analyzedInteractions} échange${data.behavior.analyzedInteractions > 1 ? 's ont' : ' a'} déjà été analysé${data.behavior.analyzedInteractions > 1 ? 's' : ''}, mais dans l’ancien format du profil. Relance l’analyse pour produire les six dimensions de la nouvelle carte.`
                : `${data.behavior.availableInteractions} échange${data.behavior.availableInteractions > 1 ? 's ont' : ' a'} été retrouvé${data.behavior.availableInteractions > 1 ? 's' : ''}. Le profil apparaîtra après leur analyse et plusieurs preuves concordantes.`
              : emptyStateOverride ?? 'Aucun échange attribuable n’a encore été retrouvé. Synchronise les emails et les réunions de cette personne.'}</EmptyState>
            {manualSyncAction && <div className="v48-profile-upgrade-action">{manualSyncAction}</div>}
          </div>
          : <div className="bd">
            <div className="bl">
              {emerging && <p className="cnt" style={{ marginBottom: 10 }}>Profil émergent — fiabilité recommandée à partir de {data.behavior.minimumInteractions} échanges analysés.</p>}
              <p className="lb lb-lg"><span className="lg">
                <span className="lg-t">Adaptation</span>
                <span className="lg-i" style={{ '--c': AXIS_TIER_COLOR.legere } as React.CSSProperties}><i />légère</span>
                <span className="lg-i" style={{ '--c': AXIS_TIER_COLOR.moyenne } as React.CSSProperties}><i />moyenne</span>
                <span className="lg-i" style={{ '--c': AXIS_TIER_COLOR.forte } as React.CSSProperties}><i />forte</span>
              </span></p>
              {hasSourceSplit && <div className="radar-src" role="group" aria-label="Source du profil comportemental">
                <button type="button" className={radarSource === 'all' ? 'on' : ''} onClick={() => setRadarSource('all')}>Toutes</button>
                <button type="button" className={radarSource === 'email' ? 'on' : ''} onClick={() => setRadarSource('email')}>Mail</button>
                <button type="button" className={radarSource === 'meeting' ? 'on' : ''} onClick={() => setRadarSource('meeting')}>Réunion</button>
              </div>}
              <BehaviorRadar axes={radarAxes} onShowTip={showTip} onHideTip={hideTip} />
              <div className="lvs">
                <p className="lvs-h"><i className="lvs-i" /><b>Vérification auto</b> · {formatDate(data.behavior.updatedAt)}</p>
                <span className="lvs-bar" />
              </div>
            </div>
            <div className="br">
              <QuadrantWidget data={data} />
              {cognitive.approachGuidance.length
                ? <DoDontPager guidance={cognitive.approachGuidance} />
                : <div className="dd-refresh">
                    <p>Les « <b>À faire / À éviter</b> » sont <b>déduits des échanges réels</b> de la personne. {manualSyncAction ? 'Lance l’analyse pour les générer.' : 'Ils apparaîtront après l’analyse de ses échanges.'}</p>
                    {manualSyncAction}
                  </div>}
            </div>
          </div>}
      </div>
    </section>

    {hasProfile && <details className="v48-detail-fold">
      <summary><div className="fold-row"><span className="fold-ic"><V48Icon name="sliders" /></span><strong>Le profil en détail</strong><span>{observedPrimary.length} dimensions · {cognitive.secondaryAxes.filter((axis) => axis.status !== 'insufficient').length} traits</span><b>⌄</b></div></summary>
      <div className="fold-b">
        <div className="g2">
          {primaryAxes.map((axis) => {
            const tier = axisTier(axis.predominancePct)
            const activePoleLabel = axis.activePole === 'left' ? axis.poleLeft : axis.activePole === 'right' ? axis.poleRight : axis.label
            return <div key={axis.id} className={`cs2 ${tier !== 'legere' ? 'hi' : ''}`} style={{ '--c': axis.status === 'insufficient' ? '#8B84A3' : AXIS_TIER_COLOR[tier] } as React.CSSProperties}>
              <span className="cs2-pc">{axis.status === 'insufficient' ? '—' : `+${axis.predominancePct} %`}</span>
              <div className="cs2-c">
                <p className="cs2-n">{activePoleLabel}{axis.status !== 'insufficient' && <span className="cs2-i">{AXIS_TIER_WORD[tier]}</span>}</p>
                <p className="cs2-d">{axis.observation || 'Observation en cours de consolidation.'}</p>
              </div>
              {axis.evidence.length > 0 && <EvidencePopover label={axis.label} evidence={axis.evidence} sourceTypes={axis.sourceTypes} />}
            </div>
          })}
        </div>
        <p className="lb detail-lb">Autres traits observés</p>
        {cognitive.secondaryAxes.map((axis) => {
          const tier = axisTier(axis.predominancePct)
          const color = axis.status === 'insufficient' ? '#8B84A3' : AXIS_TIER_COLOR[tier]
          const colorFaded = `${color}1A`
          const width = axis.status === 'insufficient' ? 0 : Math.max(1, axis.predominancePct ?? 0) / 2
          const left = 50 - (axis.activePole === 'left' ? width : 0)
          return <div key={axis.id} className="dm" style={{ '--dc': color, '--dl': colorFaded } as React.CSSProperties}>
            <span className="dm-n">{axis.label}</span>
            <span className={`dm-p ${axis.activePole === 'left' ? 'on' : ''}`}>{axis.poleLeft}</span>
            <span className="dm-t"><i className="dm-mid" />{axis.status !== 'insufficient' && <i className="dm-f" style={{ left: `${left}%`, width: `${width}%` }} />}</span>
            <span className={`dm-p r ${axis.activePole === 'right' ? 'on' : ''}`}>{axis.poleRight}</span>
            <span className="dm-v">{axis.status === 'insufficient' ? '—' : `+${axis.predominancePct} %`}</span>
          </div>
        })}
      </div>
    </details>}

    {tip && <div className="v48-tipx" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : 'none' }}>{tip.content}</div>}
  </div>
}

function MethodologyModal({ data, onClose }: { data: PersonDetailData; onClose: () => void }) {
  const dims = data.relationship.dimensions
  const rows = [
    { label: 'Confiance', weight: '25%', value: dims.confiance, description: 'Peut-on réellement compter l’un sur l’autre ? Engagements tenus, réponses aux demandes importantes, continuité — jamais déduit du seul volume d’échanges.', measured: dims.confianceMeasured },
    { label: 'Satisfaction', weight: '25%', value: dims.satisfaction, description: 'Les interactions se déroulent-elles positivement ? Retours positifs, remerciements, frustrations ou objections détectés dans le contenu réel des échanges.', measured: dims.satisfactionMeasured },
    { label: 'Engagement', weight: '20%', value: dims.engagement, description: 'La relation est-elle réellement active ? Rythme récent comparé à la baseline habituelle de cette relation, pas à un seuil absolu.', measured: dims.engagementMeasured },
    { label: 'Réciprocité', weight: '20%', value: dims.reciprocite, description: 'Les deux entretiennent-ils la relation ? Équilibre des initiatives, nuancé selon le type de relation.', measured: dims.reciprociteMeasured },
    { label: 'Ancrage', weight: '10%', value: dims.ancrage, description: dims.ancrageCarriers !== null ? `La relation dépasse-t-elle une seule personne ? ${dims.ancrageCarriers} porteur${dims.ancrageCarriers > 1 ? 's' : ''} interne${dims.ancrageCarriers > 1 ? 's' : ''} détecté${dims.ancrageCarriers > 1 ? 's' : ''}.` : 'La relation dépasse-t-elle une seule personne ? Continuité et diversité des canaux observés avec ce contact.', measured: dims.ancrageMeasured },
  ] as const
  const connectedSources = data.sources.filter((source) => source.status === 'connected')
  return <div className="rel-mask" onClick={onClose}>
    <div className="rel-modal" onClick={(event) => event.stopPropagation()}>
      <div className="mo-h"><p className="mo-t">Comment le score est calculé</p><button type="button" className="mo-x" onClick={onClose}>×</button></div>
      <div className="mo-b">
        <p className="mo-i">Le score relationnel mesure la <b>solidité du lien</b>, pas la satisfaction déclarée. Il agrège 5 axes issus des échanges réels — jamais d’un questionnaire.</p>
        {data.relationship.axisInterpretation && <p className="mo-i" style={{ fontWeight: 500 }}>{data.relationship.axisInterpretation}</p>}
        {rows.map((row) => <div className="mo-s" key={row.label}>
          <div className="mo-hd"><p className="mo-l">{row.label} <small>· {row.weight}</small></p><p className="mo-v">{row.value ?? '—'}<small>/100</small></p></div>
          <span className="mo-g"><i style={{ width: `${Math.max(0, Math.min(100, row.value ?? 0))}%` }} /></span>
          <p className="mo-d">{row.description}{!row.measured && ' Valeur temporairement neutre (50) : analyse IA pas encore effectuée pour ce contact.'}</p>
        </div>)}
        <p className="mo-sl">Sources</p>
        {connectedSources.map((source) => <div className="mo-src" key={source.provider}><span className="src t">{source.label} · Observable</span><span>Mesuré directement depuis les échanges connectés</span></div>)}
        <div className="mo-src"><span className="src v">Score · Inféré</span><span>Score dérivé des 5 axes ci-dessus, pas une donnée brute</span></div>
        <p className="mo-f">Pondération 25 / 25 / 20 / 20 / 10 · moyenne pondérée · échelle 0–100</p>
      </div>
    </div>
  </div>
}

const EG_CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
const EG_CROSS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>

// Seuils au-dessous desquels le score relationnel est marqué « à confirmer »
// (retour testing P6.2) : peu d'échanges OU confiance faible. Aucune fourchette
// Q1-Q3 n'est affichée tant que le back ne persiste pas de distribution réelle.
const SCORE_CONFIRM_MIN_INTERACTIONS = 5
const SCORE_CONFIRM_MIN_CONFIDENCE = 40

// Trois états lisibles, partagés par les deux types d'engagement (retour testing
// P2.6, puis §3 du brief « Ce qu'il faut faire ») : Glissé = échéance dépassée
// sans preuve de réalisation (rouge) · En cours = échéance à venir (violet clair)
// · À caler = nécessaire mais sans échéance connue (violet/gris) · Tenu (vert).
type ActionStatusId = 'glisse' | 'en_cours' | 'a_caler' | 'tenu'
type ActionStatus = { status: ActionStatusId; label: string; cls: 'late' | 'open' | 'caler' | 'done'; priority: number }

function isOverdue(dueISO: string | null): boolean {
  if (!dueISO) return false
  const due = new Date(dueISO).getTime()
  return Number.isFinite(due) && due < Date.now()
}

/** Fonction centralisée (§3 du brief) : le statut d'une action « Ce qu'il faut
 *  faire » dépend uniquement de deux faits réels — a-t-elle une échéance connue,
 *  cette échéance est-elle dépassée, est-elle marquée tenue — jamais d'un texte
 *  décoratif calculé séparément par composant. */
function getActionStatus(dueAt: string | null, done: boolean): ActionStatus {
  if (done) return { status: 'tenu', label: 'Tenu', cls: 'done', priority: 3 }
  if (isOverdue(dueAt)) return { status: 'glisse', label: 'Glissé', cls: 'late', priority: 0 }
  if (!dueAt) return { status: 'a_caler', label: 'À caler', cls: 'caler', priority: 1 }
  return { status: 'en_cours', label: 'En cours', cls: 'open', priority: 2 }
}

/** Impact relationnel (§5 du brief) : n'affiche jamais de label si aucun lien
 *  réel n'est établi. Seule la dimension « Confiance » est mesurée pour une
 *  personne (voir MethodologyModal : « Peut-on réellement compter l'un sur
 *  l'autre ? Engagements tenus… ») — un engagement glissé l'affecte directement.
 *  Pas de Fiabilité/Dynamique/Satisfaction inventées : ces axes ne sont pas
 *  calculés au niveau personne (voir PersonWeatherDetailSection). */
function getActionImpact(status: ActionStatusId): string | null {
  return status === 'glisse' ? 'Corrige confiance' : null
}

/** Échéance encodée en fin de contenu (« … — échéance AAAA-MM-JJ ») par l'analyse :
 *  on la sort du titre pour l'afficher proprement et en déduire l'état. Le préfixe
 *  « Nous : » (marqueur d'attribution posé par sync-email-analysis/ingest-transcript
 *  quand l'engagement est le nôtre) est retiré à l'affichage : l'avatar du
 *  répondant (EngagementAvatar) porte déjà cette information, le préfixe texte
 *  est redondant. */
function memoryDue(content: string): { title: string; dueAt: string | null } {
  const match = content.match(/\s*—\s*échéance\s+(\d{4}-\d{2}-\d{2})\s*$/)
  const withoutDue = !match || match.index === undefined ? content : content.slice(0, match.index).trim()
  const title = withoutDue.replace(/^nous\s*:\s*/i, '').trim()
  return { title, dueAt: match?.[1] ?? null }
}

// Preuve « d'où vient l'engagement » : les vrais échanges datés autour de la date
// de l'engagement (mail envoyé/reçu, réunion). Le corps des emails n'étant pas
// conservé, on référence les échanges réels, on n'invente aucune citation.
function engagementSources(data: PersonDetailData, refISO: string | null, limit = 3): PersonHistoryEvent[] {
  const comms = data.history.filter((event) => event.type === 'email' || event.type === 'meeting')
  if (comms.length === 0) return []
  if (!refISO) return comms.slice(0, limit)
  const ref = new Date(refISO).getTime()
  return [...comms]
    .sort((a, b) => Math.abs(new Date(a.occurredAt).getTime() - ref) - Math.abs(new Date(b.occurredAt).getTime() - ref))
    .slice(0, limit)
}

function sourceLine(event: PersonHistoryEvent): string {
  const when = formatDate(event.occurredAt)
  if (event.type === 'meeting') return `Réunion le ${when}${event.title && event.title !== 'Réunion' ? ` · ${event.title}` : ''}`
  const verb = event.description ?? 'Échange' // « Email envoyé » / « Email reçu »
  const subject = event.title && event.title !== event.description ? ` · ${event.title}` : ''
  return `${verb} le ${when}${subject}`
}

// Bloc « preuve » commun aux deux types d'engagement.
function EngagementProof({ data, refISO, verbatim, direction, reasoning }: {
  data: PersonDetailData
  refISO: string | null
  verbatim?: string | null
  direction?: 'inbound' | 'outbound' | null
  reasoning?: string | null
}) {
  const sources = engagementSources(data, refISO)
  const verbatimDate = refISO ? formatDate(refISO) : null
  const verbVerb = direction === 'outbound' ? 'Envoyé' : direction === 'inbound' ? 'Reçu' : null
  return <>
    {verbatim
      ? <p className="eg-proof-q">
          {(verbVerb || verbatimDate) && <span className="eg-proof-q-src">{[verbVerb, verbatimDate ? `le ${verbatimDate}` : null].filter(Boolean).join(' ')}</span>}
          « {verbatim} »
        </p>
      : reasoning && <p className="eg-proof-why"><span className="eg-proof-why-l">Pourquoi</span>{reasoning}</p>}
    {sources.length > 0 && <div className="eg-proof-src">
      <p className="eg-proof-src-h">Échanges à l’origine</p>
      <ul>{sources.map((event) => <li key={event.id}>{sourceLine(event)}</li>)}</ul>
    </div>}
    {!verbatim && <p className="eg-proof-note">Le contenu des emails n’est pas conservé (confidentialité) : Tohu référence les échanges datés d’origine, sans citation reconstituée.</p>}
  </>
}

/** Qui doit honorer l'engagement, en petit avatar rond — déduit des signaux réels
 *  disponibles, jamais une identité inventée : la personne de la fiche si le message
 *  vient d'elle (sourceDirection inbound), sinon l'owner de la fiche (à qui la
 *  recommandation/l'engagement noté manuellement s'adresse côté équipe). */
function EngagementAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  return <span className="eg-av" title={name}><ContactAvatar src={photoUrl} name={name} /></span>
}

function EngagementReco({ item, data, userId, refresh }: { item: PersonRecommendation; data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const status = getActionStatus(item.dueAt, item.status === 'completed')
  const impact = getActionImpact(status.status)
  const [proofOpen, setProofOpen] = useState(false)
  const act = (next: 'completed' | 'dismissed') => run(item.id, async () => {
    await updatePersonRecommendationStatus(data, item.id, userId, next)
    toast(next === 'completed' ? 'Engagement tenu — historisé.' : 'Écarté.')
    await refresh()
  })
  return <div className={`eg ${status.cls}`}>
    <span className="eg-s">{status.label}</span>
    <div className="eg-c">
      <p className="eg-t">{item.title}</p>
      {impact && <span className="eg-impact">{impact}</span>}
      <p className="eg-d">{item.recommendedAction || item.justification}</p>
      {item.dueAt && <p className={`eg-due${status.cls === 'late' ? ' over' : ''}`}>{status.cls === 'late' ? 'Échéance dépassée' : 'Échéance'} · {formatDate(item.dueAt)}</p>}
      <p className="eg-src">↳ {item.provenance.sourceLabel}</p>
    </div>
    <EngagementAvatar name={data.person.primaryOwnerName ?? 'Owner à confirmer'} />
    <div className="eg-b">
      <button type="button" className="info" aria-expanded={proofOpen} title="D’où vient cet engagement ?" onClick={() => setProofOpen((value) => !value)}>i</button>
      <button type="button" className="ok" title="Tenu" disabled={busy !== null} onClick={() => void act('completed')}>{EG_CHECK}</button>
      <button type="button" className="no" title="Écarter" disabled={busy !== null} onClick={() => void act('dismissed')}>{EG_CROSS}</button>
    </div>
    {proofOpen && <div className="eg-proof">
      <div className="eg-proof-meta"><span>{item.provenance.sourceLabel ?? 'Tohu'}</span>{item.provenance.observedAt && <span>· {formatDate(item.provenance.observedAt)}</span>}{item.provenance.confidence !== null && <span>· confiance {item.provenance.confidence}%</span>}</div>
      <EngagementProof data={data} refISO={item.provenance.observedAt} reasoning={item.justification || item.recommendedAction || 'Déduit de la dynamique relationnelle observée.'} />
    </div>}
  </div>
}

function EngagementMemory({ item, data, userId, refresh }: { item: PersonMemoryEntry; data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const source = item.sourceType === 'manual' ? item.authorName : item.sourceLabel ?? 'Tohu'
  const respondent = item.sourceType === 'manual'
    ? { name: item.authorName, photo: null }
    : item.sourceDirection === 'inbound'
      ? { name: data.person.fullName, photo: data.person.avatarUrl }
      : { name: data.person.primaryOwnerName ?? 'Owner à confirmer', photo: null }
  const [proofOpen, setProofOpen] = useState(false)
  const { title, dueAt } = memoryDue(item.content)
  const status = getActionStatus(dueAt, false)
  const impact = getActionImpact(status.status)
  const resolve = () => run(item.id, async () => {
    await resolvePersonMemoryEntry(data, userId, item.id)
    toast('Engagement tenu — conservé dans la mémoire relationnelle.')
    await refresh()
  })
  const dismiss = () => run(item.id, async () => {
    await dismissPersonMemoryEntry(data, userId, item.id)
    toast('Écarté — conservé dans la mémoire relationnelle.')
    await refresh()
  })
  return <div className={`eg ${status.cls}`}>
    <span className="eg-s">{status.label}</span>
    <div className="eg-c">
      <p className="eg-t">{title}</p>
      {impact && <span className="eg-impact">{impact}</span>}
      {dueAt && <p className={`eg-due${status.cls === 'late' ? ' over' : ''}`}>{status.cls === 'late' ? 'Échéance dépassée' : 'Échéance'} · {formatDate(dueAt)}</p>}
      <p className="eg-src">↳ {source} · {formatDate(item.sourceOccurredAt ?? item.createdAt)}</p>
    </div>
    <EngagementAvatar name={respondent.name} photoUrl={respondent.photo} />
    <div className="eg-b">
      <button type="button" className="info" aria-expanded={proofOpen} title="D’où vient cet engagement ?" onClick={() => setProofOpen((value) => !value)}>i</button>
      <button type="button" className="ok" title="Tenu — garder en mémoire" disabled={busy !== null} onClick={resolve}>{EG_CHECK}</button>
      <button type="button" className="no" title="Écarter (reste en mémoire)" disabled={busy !== null} onClick={dismiss}>{EG_CROSS}</button>
    </div>
    {proofOpen && <div className="eg-proof">
      <div className="eg-proof-meta"><span>{source}</span><span>· {formatDate(item.sourceOccurredAt ?? item.createdAt)}</span><span>· {item.sourceType === 'manual' ? 'Noté manuellement' : 'Détecté automatiquement'}</span></div>
      {item.sourceType === 'manual'
        ? <p className="eg-proof-q">{item.content}</p>
        : <EngagementProof data={data} refISO={item.sourceOccurredAt ?? item.createdAt} verbatim={item.sourceExcerpt} direction={item.sourceDirection} />}
    </div>}
  </div>
}

/** §1/§11 du brief : carte unique « Ce qu'il faut faire », tri déterministe
 *  (Glissé → À caler → En cours → Tenu, puis échéance la plus proche/la plus
 *  dépassée en premier) sur les mêmes engagements réels que les chips de
 *  RelationOverviewCard — pas de second calcul, pas de donnée fabriquée. */
function PersonActionsSection({ data, userId, refresh, commitments, engagementRecos }: {
  data: PersonDetailData
  userId: string
  refresh: () => Promise<void>
  commitments: PersonMemoryEntry[]
  engagementRecos: PersonRecommendation[]
}) {
  type Entry = { key: string; status: ActionStatus; node: ReactNode }
  const entries: Entry[] = [
    ...commitments.map((item): Entry => {
      const status = getActionStatus(memoryDue(item.content).dueAt, false)
      return { key: `m-${item.id}`, status, node: <EngagementMemory key={`m-${item.id}`} item={item} data={data} userId={userId} refresh={refresh} /> }
    }),
    ...engagementRecos.map((item): Entry => {
      const status = getActionStatus(item.dueAt, item.status === 'completed')
      return { key: `r-${item.id}`, status, node: <EngagementReco key={`r-${item.id}`} item={item} data={data} userId={userId} refresh={refresh} /> }
    }),
  ].sort((a, b) => a.status.priority - b.status.priority)

  return <section className="sec">
    <div className="sec-h">
      <span className="sec-ic"><V48Icon name="commitment" /></span>
      <p className="sec-t">Ce qu’il faut faire</p>
      <span className="cnt"><b>{entries.length}</b> à trier</span>
    </div>
    <div className="sec-b">
      {entries.length
        ? <div className="eng">{entries.map((entry) => entry.node)}</div>
        : <EmptyState>Rien à traiter pour le moment. Aucun engagement ou signal ne nécessite d’action.</EmptyState>}
    </div>
  </section>
}

export function V48PersonRelationView({ data, userId, refresh }: ViewProps) {
  const relation = data.relationship
  const commitments = data.memoryEntries.filter((item) => ['commitment', 'decision', 'engagement'].includes(item.entryType) && !item.resolvedAt && !item.dismissedAt)
  // Le moteur de recommandations ne pose aujourd'hui ni kind='coaching' ni
  // trigger_signal (constaté en base : 100 % des recos ouvertes sont kind='action',
  // trigger_signal toujours null) — un filtre sur ces champs viderait la liste à
  // chaque fois. Toute recommandation ouverte de Tohu est une action réelle à
  // traiter (catégories réellement produites : relationnel, ancrage, opportunité).
  const engagementRecos = data.recommendations.filter((item) => ['open', 'in_progress', 'postponed'].includes(item.status))
  const engagementCount = commitments.length + engagementRecos.length
  const delta = relation.phaseDelta
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeState, setNarrativeState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (relation.score === null) return
    let cancelled = false
    setNarrativeState('loading')
    fetchRelationshipNarrative(data.person.workspaceId, data.person.id)
      .then((result) => { if (!cancelled) { setNarrative(result.narrative); setNarrativeState('idle') } })
      .catch(() => { if (!cancelled) setNarrativeState('error') })
    return () => { cancelled = true }
  }, [data.person.workspaceId, data.person.id, relation.score])

  // Faits vérifiables pour les chips — jamais une interprétation libre : friction
  // réelle (keyMoments), engagements réellement en retard / sans date (mêmes
  // items que la logique d'engagement ci-dessus), source réellement déconnectée.
  const lastFriction = data.keyMoments.filter((moment) => moment.impact === 'friction').sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0] ?? null
  const overdueCount = engagementRecos.filter((item) => isOverdue(item.dueAt)).length
    + commitments.filter((item) => isOverdue(memoryDue(item.content).dueAt)).length
  const noDateCount = engagementRecos.filter((item) => !item.dueAt).length
    + commitments.filter((item) => memoryDue(item.content).dueAt === null).length
  const disconnectedSource = data.sources.find((source) => source.status !== 'connected') ?? null
  const relationChips: Array<{ text: string; tone: 'critical' | 'neutral' }> = [
    ...(lastFriction ? [{ text: lastFriction.title, tone: 'critical' as const }] : []),
    ...(overdueCount > 0 ? [{ text: `${overdueCount} engagement${overdueCount > 1 ? 's' : ''} en retard`, tone: 'critical' as const }] : []),
    ...(noDateCount > 0 ? [{ text: `${noDateCount} engagement${noDateCount > 1 ? 's' : ''} sans date`, tone: 'neutral' as const }] : []),
    ...(disconnectedSource ? [{ text: `${disconnectedSource.label} non connecté`, tone: 'neutral' as const }] : []),
  ].slice(0, 4)

  // Delta réellement daté : comparé au point de score précédent réellement connu
  // (granularité mensuelle des snapshots), jamais un « sur 30 j » approximatif.
  const scoredHistory = data.scoreHistory.filter((point) => point.score !== null)
  const previousScoredMonth = scoredHistory.length >= 2 ? scoredHistory.at(-2)!.monthKey : null

  return <div className="v48-person-relation">
    <RelationOverviewCard
      data={data}
      relation={relation}
      delta={delta}
      narrative={narrative}
      narrativeState={narrativeState}
      previousScoredMonth={previousScoredMonth}
      chips={relationChips}
      onOpenMethodology={() => setMethodologyOpen(true)}
    />
    <PersonWeatherDetailSection data={data} />
    <PersonActionsSection data={data} userId={userId} refresh={refresh} commitments={commitments} engagementRecos={engagementRecos} />
    <HistoryCard data={data} memory={<MemoryCard data={data} userId={userId} refresh={refresh} embedded />} />
    {methodologyOpen && <MethodologyModal data={data} onClose={() => setMethodologyOpen(false)} />}
  </div>
}

// Pictogramme soleil/nuage/pluie dérivé du SCORE (même seuils que scoreTone
// et que la Météo compte, AccountWeatherV6.tsx) — jamais de la `phase`
// growing/stable/declining, qui exigerait un historique fiable non disponible
// aujourd'hui (dimensionHistory reste vide tant que ce n'est pas persisté).
const WEATHER_ICON: Record<'good' | 'mid' | 'low' | 'na', ReactNode> = {
  good: <><circle cx="12" cy="12" r="4.6" /><path d="M12 3.4v2.4M12 18.2v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3.4 12h2.4M18.2 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" /></>,
  mid: <path d="M6.8 16.8h10.4a3.4 3.4 0 0 0 0-6.8 4.9 4.9 0 0 0-9.4-1.5A3.9 3.9 0 0 0 6.8 16.8Z" />,
  low: <><path d="M6.8 13.6h9.6a3.1 3.1 0 0 0 0-6.2 4.5 4.5 0 0 0-8.6-1.4A3.5 3.5 0 0 0 6.8 13.6Z" /><path d="M9 17l-1 2.6M13 17l-1 2.6M17 17l-1 2.6" /></>,
  na: <><circle cx="12" cy="12" r="8.2" /><path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.7M12 16.2v.1" /></>,
}
function weatherBand(score: number | null): 'good' | 'mid' | 'low' | 'na' {
  return score === null ? 'na' : score >= 70 ? 'good' : score >= 50 ? 'mid' : 'low'
}

/** Carte « Où on en est / Météo de la relation » (2e bloc de l'onglet Relation) :
 *  fusionne les anciennes cartes « Notre relation » + « Engagements pris ». Le
 *  détail des engagements (commitments/engagementRecos, calculés une seule fois
 *  dans V48PersonRelationView) nourrit à la fois les chips ci-dessous et, plus
 *  bas dans l'onglet, la carte « Ce qu'il faut faire » (PersonActionsSection). */
function RelationOverviewCard({ data, relation, delta, narrative, narrativeState, previousScoredMonth, chips, onOpenMethodology }: {
  data: PersonDetailData
  relation: PersonDetailData['relationship']
  delta: number | null
  narrative: string | null
  narrativeState: 'idle' | 'loading' | 'error'
  previousScoredMonth: string | null
  chips: Array<{ text: string; tone: 'critical' | 'neutral' }>
  onOpenMethodology: () => void
}) {
  const needsConfirm = relation.score !== null && (relation.totalInteractions < SCORE_CONFIRM_MIN_INTERACTIONS || (relation.confidence !== null && relation.confidence < SCORE_CONFIRM_MIN_CONFIDENCE))
  const synthesis = relation.score === null
    ? 'Données insuffisantes pour établir une synthèse relationnelle.'
    : narrativeState === 'loading' ? 'Analyse de l’évolution en cours…'
      : narrativeState === 'error' ? 'Synthèse indisponible pour le moment.'
        : narrative

  return <article className="rel-overview">
    <div className="rel-overview-main">
      <div className="rel-overview-head">
        <p className="rel-overview-label">Où on en est{relation.computedAt && <span className="rel-overview-date"> · {formatDate(relation.computedAt)}</span>}</p>
        <span className="rel-lens" role="group" aria-label="Échelle de la relation">
          <span className="on">Vous</span>
          <span aria-disabled="true" title="Pas encore de score de relation distinct pour l’équipe.">Équipe</span>
        </span>
      </div>
      {synthesis && <p className="rel-overview-text">{renderEmphasis(synthesis)}</p>}
      {chips.length > 0 && <div className="rel-overview-chips">
        {chips.map((chip, index) => <span key={index} className={`rel-overview-chip ${chip.tone}`}>{chip.text}</span>)}
      </div>}
    </div>
    <div className="rel-overview-side">
      <div className="rel-weather-head">
        <span className="rel-weather-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{WEATHER_ICON[weatherBand(relation.score)]}</svg></span>
        <p className="rel-weather-score" style={{ color: scoreTone(relation.score) }}>{relation.score ?? '—'}<small>/100</small></p>
        <button type="button" className="rel-weather-info" aria-label="Détail du calcul du score" onClick={onOpenMethodology}>i</button>
      </div>
      <p className="rel-weather-label">Météo de la relation{needsConfirm && <span className="rel-tbc">à confirmer</span>}</p>
      {delta !== null && <p className={`rel-weather-delta ${delta >= 0 ? 'up' : 'down'}`}>
        {delta >= 0 ? '↑ +' : '↓ '}{Math.abs(delta)}{previousScoredMonth ? <span> depuis {formatMonth(previousScoredMonth)}</span> : null}
      </p>}
      <RelationTrendChart data={data} />
    </div>
  </article>
}

function RelationTrendChart({ data }: { data: PersonDetailData }) {
  const points = useMemo(() => scoreWindow(data.scoreHistory, 12, new Date()), [data.scoreHistory])
  const scored = points.filter((point): point is PersonScorePoint & { score: number } => point.score !== null)
  if (scored.length < 2) return null
  const width = 220
  const height = 46
  const min = Math.min(...scored.map((point) => point.score))
  const max = Math.max(...scored.map((point) => point.score))
  const span = Math.max(1, max - min)
  const coords = scored.map((point, index) => ({
    x: (index / (scored.length - 1)) * width,
    y: height - 4 - ((point.score - min) / span) * (height - 8),
  }))
  const linePath = coords.map((c, index) => `${index === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${coords.at(-1)!.x.toFixed(1)},${height} L0,${height} Z`
  const last = coords.at(-1)!
  const first = scored[0]!
  const latest = scored.at(-1)!
  const peak = scored.reduce((best, point) => point.score > best.score ? point : best, scored[0]!)

  return <div className="rel-trend">
    <svg className="rel-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Évolution du score, de ${formatMonth(first.monthKey)} à ${formatMonth(latest.monthKey)}`}>
      <path d={areaPath} className="rel-trend-area" />
      <path d={linePath} className="rel-trend-line" />
      <circle cx={last.x} cy={last.y} r="2.6" className="rel-trend-dot" />
    </svg>
    <div className="rel-trend-x"><span>{formatMonth(first.monthKey)}</span><span>{formatMonth(latest.monthKey)}</span></div>
    <p className="rel-trend-sum">{scored.length} mois · {latest.score - first.score >= 0 ? '+' : ''}{latest.score - first.score} · {first.score} → {latest.score} · pic {peak.score} en {formatMonth(peak.monthKey)}</p>
  </div>
}

/** « il y a X » pour un évènement passé (contrairement à relativeDate, bascule sur
 *  les mois au-delà de 31 j — nécessaire pour dater un changement de poste). */
function timeAgoLabel(value: string | null): string {
  if (!value) return 'date à confirmer'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days === 0) return 'aujourd’hui'
  if (days < 31) return `il y a ${days} j`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `il y a ${months} mois`
  const years = Math.floor(months / 12)
  return `il y a ${years} an${years > 1 ? 's' : ''}`
}

function InsightBand({ data }: { data: PersonDetailData }) {
  // Le spotlight « depuis votre dernier échange » privilégie une actualité réelle,
  // pas un trait comportemental (registre, tonalité…) qui n'est pas un événement daté.
  const signal = data.signals.find((item) => !isBehavioralSignal(item.type)) ?? data.signals[0]
  const signalUrl = signal?.provenance.sourceUrl ?? null
  // Sous-encart daté de la carte gauche : le dernier changement de poste détecté
  // (jamais inventé — vide si le CV n'a rien détecté de nouveau).
  const nested = data.careerEntries.find((entry) => entry.entryType === 'detected_change') ?? null
  const reading = data.summary?.text || data.behavior.executiveSummary || 'Lecture en cours de construction'
  const sources = data.sources.filter((source) => source.status === 'connected').map((source) => source.label).join(' + ') || 'sources à confirmer'
  // Icône/badge du spotlight toujours violets (couleur de marque) : contrairement à la
  // liste des signaux (où la couleur par tonalité aide à scanner), ici une seule mise
  // en avant n'a pas besoin d'un code couleur — juste de rester cohérente visuellement.
  const toneColor = 'var(--violet)'
  return <div className="v48-insight-grid">
    <article className="v48-insight filled">
      <div className="v48-insight-head"><span className="v48-insight-ic"><V48Icon name="briefcase" /></span><small>Ce que montrent les échanges</small></div>
      <strong>{reading}</strong>
      {nested && <div className="v48-insight-nested">
        <small>{timeAgoLabel(nested.startedAt)}</small>
        <b>{nested.title}</b>
        {nested.description && <p>{nested.description}</p>}
      </div>}
      <p className="v48-insight-src">Dérivé de {data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} · {sources}</p>
    </article>
    <article className="v48-signal-spotlight" style={{ '--spot-tone': toneColor } as React.CSSProperties}>
      <div className="v48-spot-top">
        <span className="v48-spot-eyebrow-ic"><V48Icon name="pulse" /></span>
        <small>Depuis votre dernier échange <b>{formatDate(data.relationship.lastInteractionAt)}</b></small>
        {signal && <span className="v48-spot-kind">{signalTypeLabel(signal.type)}</span>}
      </div>
      {signal ? <div className="v48-spot-body">
        <span className="v48-spot-icon"><V48Icon name="globe" /></span>
        <div className="v48-spot-content">
          <strong>{signal.title}</strong>
          <p>{signal.summary || 'Signal détecté, détail en cours de consolidation.'}</p>
          <div className="v48-spot-foot">
            {signal.provenance.sourceLabel && <span className="v48-sig-chan"><i />{signal.provenance.sourceLabel}</span>}
            <span className="v48-spot-when">{relativeDate(signal.provenance.observedAt).toLowerCase()}</span>
          </div>
        </div>
      </div> : <p className="v48-spot-empty">Aucun nouveau signal réel depuis le dernier échange.</p>}
      {signalUrl && <a className="v48-spot-open" href={signalUrl} target="_blank" rel="noreferrer">Voir la publication →</a>}
    </article>
  </div>
}

export function V48PersonLiveView({ data, userId, refresh }: ViewProps) {
  const currentCareer = data.careerEntries.find((item) => item.current)
  // Points d'accroche RÉELS (recherche web) en priorité — relations en commun puis
  // sujets de conversation — sinon repli sur la lecture déjà disponible (synthèse,
  // actualité de poste, style d'échange) pour ne jamais afficher un vide évitable.
  const enrichment = data.enrichment
  // Lien « Voir le profil » : uniquement le vrai profil LinkedIn retrouvé par
  // l'enrichissement — jamais un lien inventé pour une relation ou un sujet qui
  // n'a pas d'URL propre.
  const enrichmentHooks: CareerHook[] = enrichment ? [
    ...enrichment.relatedPeople.map((person) => ({
      title: [person.name, person.role].filter(Boolean).join(' · '),
      text: person.why ?? 'Relation identifiée via la recherche web — peut faciliter une mise en relation.',
      source: 'LinkedIn · Recherche web',
      url: null,
    })),
    ...enrichment.talkingPoints.map((point) => ({ title: 'Sujet à aborder', text: point, source: 'Recherche web · Suggestion', url: enrichment.linkedinUrl })),
  ].slice(0, 5) : []
  const fallbackHookCandidates: Array<CareerHook | null> = [
    data.summary?.text ? { title: 'Synthèse relationnelle', text: data.summary.text, source: data.summary.provenance?.sourceLabel ?? null, url: null } : null,
    currentCareer?.description
      ? { title: 'Actualité professionnelle', text: currentCareer.description, source: currentCareer.provenance.sourceLabel, url: null }
      : null,
    data.behavior.executiveSummary ? { title: 'Style d’échange', text: data.behavior.executiveSummary, source: 'Échanges observés', url: null } : null,
  ]
  const fallbackHooks = fallbackHookCandidates.filter((item): item is NonNullable<(typeof fallbackHookCandidates)[number]> => item !== null)
  const hooks = enrichmentHooks.length ? enrichmentHooks : fallbackHooks

  return <div className="v48-person-live">
    <InsightBand data={data} />
    <div className="v48-live-layout">
      <main className="v48-live-main">
        <CareerSection data={data} userId={userId} refresh={refresh} hooks={hooks} />
      </main>
      <aside className="v48-live-rail" id="person-contact-panel">
        <SignalsCard data={data} userId={userId} refresh={refresh} />
      </aside>
    </div>
  </div>
}
