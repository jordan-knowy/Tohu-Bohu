import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { scoreWindow } from './mapping'
import type { PersonApproachScenario, PersonDetailData, PersonHistoryEvent, PersonMemoryEntry, PersonPrimaryAxis, PersonRecommendation, PersonScorePoint, PrimaryAxisId } from './types'
import { CareerSection, ContactsCard, HistoryCard, MemoryCard, SignalsCard } from './sections2'
import { deletePersonMemoryEntry, fetchRelationshipNarrative, resolvePersonMemoryEntry, updatePersonRecommendationStatus } from './service'
import { isBehavioralSignal, signalTypeLabel } from '../services/signal-labels'
import { V48Icon, SectionTitle, formatDate, formatMonth, relativeDate, scoreTone, useBusy, useToast } from './ui'
import { ContactAvatar } from '../components/ContactAvatar'

type ViewProps = {
  data: PersonDetailData
  userId: string
  refresh: () => Promise<void>
  manualSyncAction?: ReactNode
}

/** Fait ressortir en violet le segment le plus saillant d'un texte généré par
 *  l'IA, si celle-ci l'a délimité par **...** — jamais de choix arbitraire côté
 *  front sur du texte non balisé (zéro-hallu : rien n'est mis en avant sans
 *  signal explicite de la source). */
function renderEmphasis(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, index) => index % 2 === 1 ? <em key={index}>{part}</em> : part)
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

/** Copie de lien uniquement — à ne pas confondre avec un vrai partage d'accès
 *  (fiche_shares). Le lien ne fonctionnera que pour quelqu'un qui a déjà accès
 *  à cette fiche (owner ou destinataire d'un partage), pas pour tout membre
 *  de l'organisation. */
function ShareModal({ data, onClose }: { data: PersonDetailData; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? window.location.href : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard indisponible : le lien reste affiché et copiable manuellement */ }
  }
  return <div className="v48-shm" onClick={onClose}>
    <div className="v48-shp" onClick={(event) => event.stopPropagation()}>
      <div className="v48-shp-h"><p className="v48-shp-t">Partager</p><button type="button" className="v48-shp-x" onClick={onClose}>×</button></div>
      <p className="v48-shp-i">Une fiche relationnelle contient des inférences sur {data.person.fullName}.</p>
      <p className="v48-shp-l">Lien interne</p>
      <div className="v48-shp-lk"><span>{link}</span><button type="button" className="v48-shp-cp" onClick={copy}>{copied ? 'Copié' : 'Copier'}</button></div>
      <p className="v48-shp-n">Ce lien n’ouvre la fiche qu’à ceux qui y ont déjà accès (toi, ou quelqu’un à qui tu l’as explicitement partagée).</p>
    </div>
  </div>
}

export function V48PersonProfileView({ data, manualSyncAction }: ViewProps) {
  const cognitive = data.behavior.cognitiveProfile
  const primaryAxes = cognitive.primaryAxes
  const observedPrimary = primaryAxes.filter((axis) => axis.status !== 'insufficient')
  const evidenceThresholdReached = data.behavior.analyzedInteractions >= data.behavior.profileMinimumInteractions
  const hasProfile = evidenceThresholdReached && observedPrimary.length > 0
  const emerging = hasProfile && data.behavior.analyzedInteractions < data.behavior.minimumInteractions
  // « Posture à adopter » = conseil d'adaptation RÉELLEMENT déduit de l'analyse
  // (résumé du 1er scénario d'approche, ou observation de posture). Aucun gabarit
  // générique : à défaut, la carte affiche « profil en construction ».
  const posture = cognitive.approachGuidance[0]?.summary || cognitive.posture.observation || null

  const nextMeeting = useMemo(() => {
    const now = Date.now()
    const upcoming = data.history.filter((event) => event.type === 'meeting' && new Date(event.occurredAt).getTime() > now)
    return upcoming.length ? upcoming.reduce((soonest, event) => new Date(event.occurredAt) < new Date(soonest.occurredAt) ? event : soonest) : null
  }, [data.history])

  const [tip, setTip] = useState<Tip | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
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
    <div className="now">
      <article className="rdv">
        <span className="rdv-icon"><V48Icon name="calendar" /></span>
        <div>
          <p className="rdv-l">Prochain rendez-vous <span className="lvb2"><span className="lvd" />Live</span></p>
          {nextMeeting
            ? <><p className="rdv-t">{formatDate(nextMeeting.occurredAt)}</p><p className="rdv-s">{nextMeeting.title}{nextMeeting.sourceLabel ? ` · ${nextMeeting.sourceLabel}` : ''}</p></>
            : <><p className="rdv-t">Aucun rendez-vous synchronisé</p><p className="rdv-s">Connecte ou synchronise un agenda pour préparer le prochain échange.</p></>}
        </div>
        <button type="button" className="rdv-b" onClick={() => setShareOpen(true)}><V48Icon name="share" />Partager</button>
      </article>
      <article className="po">
        <p className="po-l">Posture à adopter</p>
        <p className="po-t">{posture ? renderEmphasis(posture) : 'Le profil est encore en construction. Tohu attend davantage d’échanges observables avant de recommander une posture.'}</p>
      </article>
    </div>

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
              : 'Aucun échange attribuable n’a encore été retrouvé. Synchronise les emails et les réunions de cette personne.'}</EmptyState>
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
              {axis.evidence.length > 0 && <button
                type="button"
                className="pv"
                onMouseEnter={(event) => showTip(event, <>
                  <p className="v48-tipx-t">{axis.label} · preuves</p>
                  <ul className="v48-tipx-e">{axis.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </>)}
                onFocus={(event) => showTip(event, <>
                  <p className="v48-tipx-t">{axis.label} · preuves</p>
                  <ul className="v48-tipx-e">{axis.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </>)}
                onMouseLeave={hideTip}
                onBlur={hideTip}
              >preuves</button>}
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
    {shareOpen && <ShareModal data={data} onClose={() => setShareOpen(false)} />}
  </div>
}

const SCORE_PERIODS = [6, 12, 36] as const
type ScorePeriod = (typeof SCORE_PERIODS)[number]

function ScoreChart({ data }: { data: PersonDetailData }) {
  const [months, setMonths] = useState<ScorePeriod>(12)
  const [hover, setHover] = useState<{ index: number; left: number } | null>(null)
  // Correction ajoutée au centrage (translateX(-50%)) de .ch-tip pour qu'elle ne
  // déborde jamais du cadre du graphique sur le dernier point (bord droit) —
  // mesurée sur le rendu réel (offsetWidth, indépendant du transform) donc
  // fiable quelle que soit la longueur du contenu.
  const [tipOffset, setTipOffset] = useState(0)
  const chartRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!hover || !chartRef.current || !tipRef.current) return
    const chartWidth = chartRef.current.clientWidth
    const tipWidth = tipRef.current.offsetWidth
    const margin = 6
    const desiredLeftEdge = hover.left - tipWidth / 2
    const clampedLeftEdge = Math.min(Math.max(desiredLeftEdge, margin), chartWidth - tipWidth - margin)
    setTipOffset(clampedLeftEdge - desiredLeftEdge)
  }, [hover])
  const points = useMemo(() => scoreWindow(data.scoreHistory, months, new Date()), [data.scoreHistory, months])
  const exchangesByMonth = useMemo(() => {
    const map = new Map<string, number>()
    for (const event of data.history) {
      if (event.type !== 'meeting' && event.type !== 'email') continue
      const key = event.occurredAt.slice(0, 7)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [data.history])
  const momentByMonth = useMemo(() => {
    const map = new Map<string, string>()
    for (const moment of data.keyMoments) { const key = moment.occurredAt.slice(0, 7); if (!map.has(key)) map.set(key, moment.title) }
    return map
  }, [data.keyMoments])
  const firstMonthKey = data.relationship.firstInteractionAt?.slice(0, 7) ?? null
  const first = points[0]?.monthKey
  const last = points.at(-1)?.monthKey
  const hovered = hover ? points[hover.index] : null
  const previousScore = hover ? points.slice(0, hover.index).reverse().find((point) => point.score !== null)?.score ?? null : null
  const delta = hovered && hovered.score !== null && previousScore !== null ? hovered.score - previousScore : null
  const hoveredExchanges = hovered ? exchangesByMonth.get(hovered.monthKey) ?? 0 : 0
  const hoveredMoment = hovered ? momentByMonth.get(hovered.monthKey) : undefined
  const hoveredIsStart = hovered ? hovered.monthKey === firstMonthKey : false
  return <>
    <div className="seg" role="tablist" aria-label="Période affichée">
      {SCORE_PERIODS.map((period) => <span key={period} role="tab" aria-selected={months === period} className={months === period ? 'on' : ''} onClick={() => setMonths(period)}>{period} M</span>)}
    </div>
    <div className="chart" role="img" ref={chartRef} aria-label={points.map((point) => `${formatMonth(point.monthKey)} : ${point.score ?? 'sans donnée'}`).join(', ')}>
      {points.map((point, index) => <i
        key={point.monthKey}
        tabIndex={0}
        style={{ height: point.score === null ? 8 : Math.max(6, Math.round(120 * point.score / 100)), background: point.score === null ? '#E3DEF2' : index === points.length - 1 ? 'linear-gradient(180deg,#2EA86A,#4FBD85)' : 'linear-gradient(180deg,#3FAEBE,#2896A8)' }}
        onMouseEnter={(event) => setHover({ index, left: event.currentTarget.offsetLeft + event.currentTarget.offsetWidth / 2 })}
        onMouseLeave={() => setHover(null)}
        onFocus={(event) => setHover({ index, left: event.currentTarget.offsetLeft + event.currentTarget.offsetWidth / 2 })}
        onBlur={() => setHover(null)}
      />)}
      {hover && hovered && <div ref={tipRef} className="ch-tip" style={{ left: hover.left, transform: `translateX(calc(-50% + ${tipOffset}px))` }}>
        <div className="ch-tip-m">{formatMonth(hovered.monthKey)}{hoveredIsStart ? ' · début' : ''}</div>
        {hovered.score !== null && <div className="ch-tip-v">{hovered.score}<small>/100</small>{delta !== null && <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? `↗ +${delta}` : `↘ ${delta}`} pts</span>}</div>}
        <div className="ch-tip-s">{hoveredIsStart ? 'Début de la relation' : hoveredExchanges > 0 ? `${hoveredExchanges} échange${hoveredExchanges > 1 ? 's' : ''} ce mois` : 'Aucun échange ce mois'}</div>
        {hoveredMoment && <div className="ch-tip-x">✦ {hoveredMoment}</div>}
      </div>}
    </div>
    <div className="ch-x"><span>{first ? formatMonth(first) : ''}</span><span>{last ? formatMonth(last) : ''}</span></div>
  </>
}

function MethodologyModal({ data, onClose }: { data: PersonDetailData; onClose: () => void }) {
  const dims = data.relationship.dimensions
  const rows = [
    { label: 'Confiance', weight: '25%', value: dims.confiance, description: 'Peut-on réellement compter l’un sur l’autre ? Engagements tenus, réponses aux demandes importantes, continuité — jamais déduit du seul volume d’échanges.', measured: dims.confianceMeasured },
    { label: 'Satisfaction', weight: '25%', value: dims.satisfaction, description: 'Les interactions se déroulent-elles positivement ? Retours positifs, remerciements, frustrations ou objections détectés dans le contenu réel des échanges.', measured: dims.satisfactionMeasured },
    { label: 'Engagement', weight: '20%', value: dims.engagement, description: 'La relation est-elle réellement active ? Rythme récent comparé à la baseline habituelle de cette relation, pas à un seuil absolu.', measured: true },
    { label: 'Réciprocité', weight: '20%', value: dims.reciprocite, description: 'Les deux entretiennent-ils la relation ? Équilibre des initiatives, nuancé selon le type de relation.', measured: true },
    { label: 'Ancrage', weight: '10%', value: dims.ancrage, description: dims.ancrageCarriers !== null ? `La relation dépasse-t-elle une seule personne ? ${dims.ancrageCarriers} porteur${dims.ancrageCarriers > 1 ? 's' : ''} interne${dims.ancrageCarriers > 1 ? 's' : ''} détecté${dims.ancrageCarriers > 1 ? 's' : ''}.` : 'La relation dépasse-t-elle une seule personne ? Nombre de membres de l’équipe ayant une relation réelle avec ce contact.', measured: true },
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

function quartile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const next = sorted[base + 1]
  return Math.round(next === undefined ? sorted[base]! : sorted[base]! + (pos - base) * (next - sorted[base]!))
}

/** Fourchette RÉELLEMENT observée (Q1–Q3) sur l'historique de score — jamais un
 *  intervalle de confiance inventé. null sous 5 points datés ou si plat. */
function observedScoreRange(scores: Array<number | null>): { q1: number; q3: number } | null {
  const clean = scores.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length < 5) return null
  const q1 = quartile(clean, 0.25)
  const q3 = quartile(clean, 0.75)
  return q3 > q1 ? { q1, q3 } : null
}

// Trois états lisibles, partagés par les deux types d'engagement (retour testing
// P2.6) : À faire (violet) · Glissé = échéance passée (rouge) · Tenu (vert).
type EngagementState = { cls: 'late' | 'open' | 'done'; label: string }

function isOverdue(dueISO: string | null): boolean {
  if (!dueISO) return false
  const due = new Date(dueISO).getTime()
  return Number.isFinite(due) && due < Date.now()
}

function engagementStatus(item: PersonRecommendation): EngagementState {
  if (item.status === 'completed') return { cls: 'done', label: 'Tenu' }
  if (isOverdue(item.dueAt)) return { cls: 'late', label: 'Glissé' }
  return { cls: 'open', label: 'À faire' }
}

/** Échéance encodée en fin de contenu (« … — échéance AAAA-MM-JJ ») par l'analyse :
 *  on la sort du titre pour l'afficher proprement et en déduire l'état. */
function memoryDue(content: string): { title: string; dueAt: string | null } {
  const match = content.match(/\s*—\s*échéance\s+(\d{4}-\d{2}-\d{2})\s*$/)
  if (!match || match.index === undefined) return { title: content, dueAt: null }
  return { title: content.slice(0, match.index).trim(), dueAt: match[1] ?? null }
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
  const status = engagementStatus(item)
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
  const status: EngagementState = isOverdue(dueAt) ? { cls: 'late', label: 'Glissé' } : { cls: 'open', label: 'À faire' }
  const resolve = () => run(item.id, async () => {
    await resolvePersonMemoryEntry(data, userId, item.id)
    toast('Engagement tenu — conservé dans la mémoire relationnelle.')
    await refresh()
  })
  const remove = () => run(item.id, async () => {
    await deletePersonMemoryEntry(data, item.id)
    toast('Engagement supprimé.')
    await refresh()
  })
  return <div className={`eg ${status.cls}`}>
    <span className="eg-s">{status.label}</span>
    <div className="eg-c">
      <p className="eg-t">{title}</p>
      {dueAt && <p className={`eg-due${status.cls === 'late' ? ' over' : ''}`}>{status.cls === 'late' ? 'Échéance dépassée' : 'Échéance'} · {formatDate(dueAt)}</p>}
      <p className="eg-src">↳ {source} · {formatDate(item.sourceOccurredAt ?? item.createdAt)}</p>
    </div>
    <EngagementAvatar name={respondent.name} photoUrl={respondent.photo} />
    <div className="eg-b">
      <button type="button" className="info" aria-expanded={proofOpen} title="D’où vient cet engagement ?" onClick={() => setProofOpen((value) => !value)}>i</button>
      <button type="button" className="ok" title="Tenu — garder en mémoire" disabled={busy !== null} onClick={resolve}>{EG_CHECK}</button>
      <button type="button" className="no" title="Supprimer" disabled={busy !== null} onClick={remove}>{EG_CROSS}</button>
    </div>
    {proofOpen && <div className="eg-proof">
      <div className="eg-proof-meta"><span>{source}</span><span>· {formatDate(item.sourceOccurredAt ?? item.createdAt)}</span><span>· {item.sourceType === 'manual' ? 'Noté manuellement' : 'Détecté automatiquement'}</span></div>
      {item.sourceType === 'manual'
        ? <p className="eg-proof-q">{item.content}</p>
        : <EngagementProof data={data} refISO={item.sourceOccurredAt ?? item.createdAt} verbatim={item.sourceExcerpt} direction={item.sourceDirection} />}
    </div>}
  </div>
}

export function V48PersonRelationView({ data, userId, refresh }: ViewProps) {
  const relation = data.relationship
  const commitments = data.memoryEntries.filter((item) => ['commitment', 'decision', 'engagement'].includes(item.entryType) && !item.resolvedAt)
  const openRecos = data.recommendations.filter((item) => ['open', 'in_progress', 'postponed'].includes(item.status))
  // Un engagement = promesse tirée des échanges (posture/coaching ou reco déclenchée par un
  // signal de contenu). « Renouer le contact » (reco fondée sur le score, sans signal) n'en est pas un.
  const engagementRecos = openRecos.filter((item) => item.kind === 'coaching' || item.triggerSignal !== null)
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

  const ageLabel = relation.relationshipAgeDays === null ? null
    : relation.relationshipAgeDays < 30 ? `${relation.relationshipAgeDays} j`
      : `~${Math.round(relation.relationshipAgeDays / 30)} mois`
  const scoreRange = useMemo(() => observedScoreRange(data.scoreHistory.map((point) => point.score)), [data.scoreHistory])

  return <div className="v48-person-relation">
    <div className="cols">
      <section className="sec rel-card">
        <div className="sec-h"><span className="sec-ic"><V48Icon name="pulse" /></span><p className="sec-t">Notre relation</p>
          <button type="button" className="det det-i" aria-label="Détail du calcul du score" onClick={() => setMethodologyOpen(true)}>i</button></div>
        <div className="sec-b">
          <div className="rel-top">
            <p className="big" style={{ color: scoreTone(relation.score) }}>{relation.score ?? '—'}</p>
            {delta !== null && <span className={`evo ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '↗ +' : '↘ '}{Math.abs(delta)} pts</span>}
            {relation.score !== null && (relation.totalInteractions < SCORE_CONFIRM_MIN_INTERACTIONS || (relation.confidence !== null && relation.confidence < SCORE_CONFIRM_MIN_CONFIDENCE)) &&
              <span className="rel-tbc" title={`Score établi sur ${relation.totalInteractions} échange${relation.totalInteractions > 1 ? 's' : ''}${relation.confidence !== null ? ` · confiance ${relation.confidence}%` : ''} — à confirmer avec plus d’historique.`}>à confirmer</span>}
          </div>
          <div className="mini">
            {ageLabel && <span><b>{ageLabel}</b> d’ancienneté</span>}
            <span><b>{relation.totalInteractions}</b> échange{relation.totalInteractions > 1 ? 's' : ''}</span>
            {scoreRange && <span title="Fourchette réellement observée sur l’historique du score (Q1–Q3) — pas une prédiction.">fourchette <b>{scoreRange.q1}–{scoreRange.q3}</b></span>}
          </div>
          {relation.score !== null && <p className="rel-narrative">
            {narrativeState === 'loading' ? 'Analyse de l’évolution en cours…' : narrativeState === 'error' ? 'Synthèse indisponible pour le moment.' : narrative}
          </p>}
          <ScoreChart data={data} />
          <div className="lvs"><p className="lvs-h"><i className="lvs-i" />Dernière synchronisation : <b>{relativeDate(relation.computedAt).toLowerCase()}</b></p><span className="lvs-bar" /></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><span className="sec-ic"><V48Icon name="commitment" /></span><p className="sec-t">Engagements pris</p><span className="cnt"><b>{engagementCount}</b> à suivre</span></div>
        <div className="sec-b">
          <p className="hint-l">Ce qui a été promis dans les échanges. Garde ce qui compte, écarte le reste.</p>
          {engagementCount > 0
            ? <div className="eng">
              {engagementRecos.map((item) => <EngagementReco key={item.id} item={item} data={data} userId={userId} refresh={refresh} />)}
              {commitments.map((item) => <EngagementMemory key={item.id} item={item} data={data} userId={userId} refresh={refresh} />)}
            </div>
            : <EmptyState>Aucun engagement n’a encore été extrait des échanges. Ils apparaîtront après l’analyse du contenu des emails et réunions.</EmptyState>}
        </div>
      </section>
    </div>
    <HistoryCard data={data} memory={<MemoryCard data={data} userId={userId} refresh={refresh} embedded />} />
    {methodologyOpen && <MethodologyModal data={data} onClose={() => setMethodologyOpen(false)} />}
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
  return <div className="v48-insight-grid">
    <article className="v48-insight filled">
      <div className="v48-insight-head"><span className="v48-insight-ic"><V48Icon name="sparkle" /></span><small>Ce que montrent les échanges</small></div>
      <strong>{reading}</strong>
      {nested && <div className="v48-insight-nested">
        <small>{timeAgoLabel(nested.startedAt)}</small>
        <b>{nested.title}</b>
        {nested.description && <p>{nested.description}</p>}
      </div>}
      <p className="v48-insight-src">Dérivé de {data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} · {sources}</p>
    </article>
    <article className="v48-signal-spotlight">
      <small>Depuis votre dernier échange <b>{formatDate(data.relationship.lastInteractionAt)}</b></small>
      {signal ? <><span>{signalTypeLabel(signal.type)}</span><strong>{signal.title}</strong><p>{signal.summary || 'Signal détecté, détail en cours de consolidation.'}</p><em>{signal.provenance.sourceLabel} · {relativeDate(signal.provenance.observedAt).toLowerCase()}</em>
        {signalUrl && <a className="v48-sig-open" href={signalUrl} target="_blank" rel="noreferrer">Voir la publication →</a>}</>
        : <p>Aucun nouveau signal réel depuis le dernier échange.</p>}
    </article>
  </div>
}

export function V48PersonLiveView({ data, userId, refresh }: ViewProps) {
  const currentCareer = data.careerEntries.find((item) => item.current)
  // Points d'accroche RÉELS (recherche web) en priorité — relations en commun puis
  // sujets de conversation — sinon repli sur la lecture déjà disponible (synthèse,
  // actualité de poste, style d'échange) pour ne jamais afficher un vide évitable.
  const enrichment = data.enrichment
  const enrichmentHooks = enrichment ? [
    ...enrichment.relatedPeople.map((person) => ({
      title: [person.name, person.role].filter(Boolean).join(' · '),
      text: person.why ?? 'Relation identifiée via la recherche web — peut faciliter une mise en relation.',
      source: 'LinkedIn · Recherche web',
    })),
    ...enrichment.talkingPoints.map((point) => ({ title: 'Sujet à aborder', text: point, source: 'Recherche web · Suggestion' })),
  ].slice(0, 5) : []
  const fallbackHookCandidates = [
    data.summary?.text ? { title: 'Synthèse relationnelle', text: data.summary.text, source: data.summary.provenance?.sourceLabel ?? null } : null,
    currentCareer?.description
      ? { title: 'Actualité professionnelle', text: currentCareer.description, source: currentCareer.provenance.sourceLabel }
      : null,
    data.behavior.executiveSummary ? { title: 'Style d’échange', text: data.behavior.executiveSummary, source: 'Échanges observés' } : null,
  ]
  const fallbackHooks = fallbackHookCandidates.filter((item): item is NonNullable<(typeof fallbackHookCandidates)[number]> => item !== null)
  const hooks = enrichmentHooks.length ? enrichmentHooks : fallbackHooks

  return <div className="v48-person-live">
    <InsightBand data={data} />
    <div className="v48-live-layout">
      <main className="v48-live-main">
        <CareerSection data={data} userId={userId} refresh={refresh} />
        <section className="v48-section v48-hooks">
          <SectionTitle icon="sparkle" title="Points d’accroche" />
          <div>
            {hooks.map((hook) => <article key={hook.title}><span><V48Icon name="sparkle" /></span><div><h3>{hook.title}</h3><p>{hook.text}</p><small>{hook.source || 'Source à confirmer'}</small></div></article>)}
            {!hooks.length && <EmptyState>Aucun point d’accroche suffisamment étayé n’est disponible.</EmptyState>}
          </div>
        </section>
      </main>
      <aside className="v48-live-rail" id="person-contact-panel">
        <ContactsCard data={data} userId={userId} refresh={refresh} />
        <SignalsCard data={data} userId={userId} refresh={refresh} />
      </aside>
    </div>
  </div>
}
