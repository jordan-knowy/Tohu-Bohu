import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { scoreWindow } from './mapping'
import { acceptPersonMergeSuggestion, acceptPersonNameSuggestion, dismissPersonMergeSuggestion, dismissPersonNameSuggestion, savePersonRecommendationFeedback, updatePersonRecommendationStatus } from './service'
import { scoreFreshness } from '../services/surface-state'
import type { PersonCognitiveTheme, PersonDetailData, PersonMergeSuggestion, PersonRecommendation } from './types'
import { Csec, Empty, Prov, confidenceLevel, formatDate, formatMonth, phaseLabel, provenanceLabel, relativeDate, scoreTone, seniorityLabel, useBusy, useToast } from './ui'

type SectionProps = { data: PersonDetailData; userId: string; refresh: () => Promise<void> }

const WaveIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
const SparkIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 11.9 10.1 8.6z" /></svg>
const CircleIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" strokeLinecap="round" /></svg>
const BoltIcon = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" /></svg>
const CheckIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
const CrossIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>

// ─── Notre relation ────────────────────────────────────────────────────────

export function RelationSection({ data }: { data: PersonDetailData }) {
  const relation = data.relationship
  const [months, setMonths] = useState(12)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const points = useMemo(() => scoreWindow(data.scoreHistory, months, new Date()), [data.scoreHistory, months])
  const scored = points.filter((point) => point.score !== null)
  const delta = scored.length >= 2 ? (scored.at(-1)!.score ?? 0) - (scored[0]!.score ?? 0) : null
  const currentKey = data.scoreHistory.at(-1)?.monthKey
  const dims: Array<{ label: string; value: number | null; note: string }> = [
    { label: 'Intensité', value: relation.dimensions.intensity, note: 'Volume et régularité des échanges observés.' },
    { label: 'Réciprocité', value: relation.dimensions.reciprocity, note: 'Équilibre entre messages initiés et reçus.' },
    { label: 'Longévité', value: relation.dimensions.longevity, note: 'Durée et constance de la relation dans le temps.' },
  ]
  const hasDims = dims.some((dim) => dim.value !== null)
  const sourceLabels = data.sources.filter((source) => source.status === 'connected').map((source) => `${source.label} · Observable`)
  const freshness = relation.score !== null ? scoreFreshness(relation.computedAt, new Date()) : 'ready'

  return <Csec id="sec-mem" icon={WaveIcon} title="Notre relation">
    <div className="es-stats" style={{ padding: '2px 0 6px', gap: 30, display: 'flex', flexWrap: 'wrap' }}>
      <div>
        <div className="es-l">NPS relationnel</div>
        <div className="es-n" style={{ color: scoreTone(relation.score) }}>
          {relation.score ?? '—'}
          <span className="ic" tabIndex={0}>i<span className="tip">
            <span className="tip-h">Comment c’est calculé</span>
            Score composite produit par le moteur relationnel backend (intensité · réciprocité · récence). Échelle 0–100. Le front n’effectue aucun calcul.
            <span className="tip-f">{relation.computedAt ? `Calculé le ${formatDate(relation.computedAt)}` : 'En attente du moteur backend.'}</span>
          </span></span>
          {freshness === 'stale' && <span className="reco-prio" style={{ marginLeft: 8, fontSize: 9.5, verticalAlign: 'middle' }} title="Le dernier calcul date de plus de 48 h — peut ne plus refléter les tout derniers échanges.">⏱ Mise à jour retardée</span>}
        </div>
      </div>
      <div>
        <div className="es-l">Ancienneté relation</div>
        <div className="es-n" style={{ color: 'var(--violet-d)' }}>{seniorityLabel(relation.firstInteractionAt)}</div>
      </div>
      <div>
        <div className="es-l">Échanges</div>
        <div className="es-n" style={{ color: 'var(--sage)' }}>{relation.totalInteractions || '—'}</div>
      </div>
      <div>
        <div className="es-l">Phase</div>
        <div className="es-n" style={{ color: 'var(--violet-d)', fontSize: 16 }}>{phaseLabel(relation.phase)}</div>
      </div>
    </div>
    <Prov items={[...sourceLabels, 'Score · Inféré (moteur backend)'].slice(0, 4)} />

    {relation.score === null && !data.scoreHistory.length
      ? <Empty title="Données insuffisantes">Tohu ne dispose pas encore d’un historique suffisant pour calculer un score fiable. Le score apparaîtra après les prochains calculs backend.</Empty>
      : <>
        <div className="nps-head">
          <div className="nps-title"><b>{months} mois</b>{delta !== null && <> (<b>{delta >= 0 ? `↗ +${delta}` : `↘ ${delta}`}</b>)</>}</div>
          <div className="nps-toggle">
            {[6, 12, 36].map((value) => <button key={value} type="button" className={months === value ? 'on' : ''} aria-pressed={months === value} onClick={() => setMonths(value)}>{value} M</button>)}
          </div>
        </div>
        {scored.length === 0
          ? <Empty title="Historique en construction">L’évolution apparaîtra après plusieurs synchronisations.</Empty>
          : <>
            <div className="cwrap" style={{ overflow: 'visible', position: 'relative' }}>
              <div className="nps-bars" id="npsBars" role="img" aria-label={`Évolution du score relationnel sur ${months} mois : ${scored.map((point) => `${formatMonth(point.monthKey)} ${point.score}`).join(', ')}`}>
                {points.map((point, index) => <div
                  key={point.monthKey}
                  className={`npsbar ${point.score === null ? 'empty' : ''} ${point.monthKey === currentKey ? 'cur' : ''}`}
                  style={{ height: point.score === null ? 6 : Math.max(8, Math.round(point.score / 100 * 118)) }}
                  onMouseEnter={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
                  onMouseMove={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
                  onMouseLeave={() => setHover(null)}
                />)}
              </div>
              <div className="nps-xaxis"><span>{formatMonth(points[0]?.monthKey ?? '')}</span><span>{formatMonth(points.at(-1)?.monthKey ?? '')}</span></div>
              {hover && points[hover.index] && <div className="ctt" style={{ display: 'block', position: 'fixed', left: Math.min(hover.x + 14, window.innerWidth - 226), top: hover.y + 16 }}>
                {(() => {
                  const point = points[hover.index]!
                  if (point.score === null) return <><div className="tt-h">{formatMonth(point.monthKey)}</div><div className="tt-base">sans donnée</div><div className="tt-r">Aucun snapshot persisté sur ce mois.</div></>
                  const previous = points.slice(0, hover.index).reverse().find((item) => item.score !== null)
                  const pointDelta = previous?.score !== null && previous !== undefined ? point.score - previous.score! : null
                  return <>
                    <div className="tt-h">{formatMonth(point.monthKey)} · score {point.score}</div>
                    {pointDelta === null ? <div className="tt-base">point de départ</div> : <div className={`tt-d ${pointDelta > 0 ? 'pos' : pointDelta < 0 ? 'neg' : 'flat'}`}>{pointDelta > 0 ? '+' : ''}{pointDelta} pts{pointDelta === 0 ? ' (stable)' : ''}</div>}
                    <div className="tt-r">{[point.phase ? phaseLabel(point.phase) : null, point.interactionCount !== null ? `${point.interactionCount} interactions` : null, confidenceLevel(point.confidence) ? `confiance ${confidenceLevel(point.confidence)}` : null].filter(Boolean).join(' · ') || 'Snapshot persisté.'}</div>
                  </>
                })()}
              </div>}
            </div>
            <div className="nps-leg">
              <span className="cl-item"><span className="cl-dot" style={{ background: 'var(--violet)' }} />NPS du mois</span>
              <span className="cl-item"><span className="cl-dot" style={{ background: 'var(--sage)' }} />Mois courant</span>
              <span className="cl-item"><span className="cl-dot" style={{ background: '#E6E1F2' }} />Sans donnée</span>
            </div>
          </>}
        {hasDims
          ? <div className="mem-dims">
            {dims.map((dim) => dim.value !== null && <div className="dim-card" key={dim.label}>
              <div className="dim-ring-l">{dim.label} <span className="dim-i" data-tip={dim.label === 'Intensité' ? 'Fréquence et volume des échanges.' : dim.label === 'Réciprocité' ? 'Équilibre de l’échange — qui initie, qui répond.' : 'Durée et constance de la relation.'}>i</span></div>
              <div className="dim-bar-block">
                <div className="dim-bar-v">{Math.round(dim.value)}<span className="dim-bar-u">/100</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${dim.value}%`, background: scoreTone(dim.value) }} /></div>
              </div>
              <div className="dim-def">{dim.note}</div>
            </div>)}
          </div>
          : <div className="pp-note">Dimensions (intensité · réciprocité · récence) indisponibles — elles apparaîtront quand le moteur relationnel backend aura produit un snapshot dimensionné.</div>}
      </>}
  </Csec>
}

// ─── Identité (nom résolu, doublons inter-comptes) ─────────────────────────

const IdIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" /></svg>

function NameSuggestionCard({ data, userId, refresh }: SectionProps) {
  const suggestion = data.nameSuggestion
  const toast = useToast()
  const [busy, run] = useBusy()
  if (!suggestion) return null
  const accept = () => run('accept-name', async () => {
    await acceptPersonNameSuggestion(data, userId, suggestion.id, suggestion.suggestedFullName)
    toast(`Personne renommée en ${suggestion.suggestedFullName}.`)
    await refresh()
  })
  const dismiss = () => run('dismiss-name', async () => {
    await dismissPersonNameSuggestion(userId, suggestion.id)
    toast('Suggestion ignorée.')
    await refresh()
  })
  return <article className="krs-card krs-action" data-type="action">
    <div className="krs-band" />
    <div className="krs-main">
      <div className="krs-crow">
        <span className="krs-ic">{IdIcon}</span>
        <span className="krs-kind tache">Nom trouvé</span>
        <span className="krs-at">Renommer en « {suggestion.suggestedFullName} » ?</span>
      </div>
      <div className="krs-aw">{suggestion.evidence ?? (suggestion.source === 'signature' ? 'Trouvé dans la signature d’un email reçu.' : 'Trouvé via recherche web.')}</div>
      <div className="krs-arow">
        <span className="krs-asig">Le nom actuel (« {data.person.fullName} ») ressemble à un pseudo dérivé de l’adresse email.</span>
        <span className="krs-do-inline">
          <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void accept()}>{CheckIcon} Confirmer</button>
          <button type="button" className="krs-b sm no" disabled={busy !== null} onClick={() => void dismiss()} aria-label="Ignorer">{CrossIcon}</button>
        </span>
      </div>
    </div>
  </article>
}

function MergeSuggestionCard({ data, userId, refresh, item }: SectionProps & { item: PersonMergeSuggestion }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const accept = () => run(`accept-merge-${item.id}`, async () => {
    await acceptPersonMergeSuggestion(data, userId, item.id, item.otherContactId)
    toast(`Fiches fusionnées avec ${item.otherContactName}.`)
    await refresh()
  })
  const dismiss = () => run(`dismiss-merge-${item.id}`, async () => {
    await dismissPersonMergeSuggestion(userId, item.id)
    toast('Suggestion écartée — ce ne sont pas la même personne.')
    await refresh()
  })
  const clues: string[] = []
  if (item.evidence.linkedin_match) clues.push('même profil LinkedIn')
  if (item.evidence.same_company) clues.push('même entreprise')
  if (item.evidence.shares_surname) clues.push('nom de famille partagé')
  if (item.evidence.name_similarity !== undefined) clues.push(`similarité de nom ${Math.round(item.evidence.name_similarity * 100)} %`)
  return <article className="krs-card krs-action" data-type="action">
    <div className="krs-band" />
    <div className="krs-main">
      <div className="krs-crow">
        <span className="krs-ic">{IdIcon}</span>
        <span className="krs-kind tache">Doublon probable</span>
        <span className="krs-at">{item.otherContactName}{item.otherContactEmail ? ` · ${item.otherContactEmail}` : ''}</span>
        <span className="krs-prio">confiance {item.confidence === 'high' ? 'forte' : 'moyenne'}</span>
      </div>
      <div className="krs-aw">Probablement la même personne que cette fiche{clues.length ? ` — ${clues.join(', ')}.` : '.'}</div>
      <div className="krs-arow">
        <span className="krs-asig">Fusionner rattache tout l’historique (emails, réunions, signaux) de {item.otherContactName} à cette fiche.</span>
        <span className="krs-do-inline">
          <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void accept()}>{CheckIcon} Fusionner</button>
          <button type="button" className="krs-b sm no" disabled={busy !== null} onClick={() => void dismiss()} aria-label="Pas la même personne">{CrossIcon}</button>
        </span>
      </div>
    </div>
  </article>
}

export function IdentitySuggestionsSection({ data, userId, refresh }: SectionProps) {
  if (!data.nameSuggestion && !data.mergeSuggestions.length) return null
  return <Csec id="sec-identity" icon={IdIcon} title="Identité">
    <div className="krs-stack">
      {data.nameSuggestion && <NameSuggestionCard data={data} userId={userId} refresh={refresh} />}
      {data.mergeSuggestions.map((item) => <MergeSuggestionCard key={item.id} data={data} userId={userId} refresh={refresh} item={item} />)}
    </div>
  </Csec>
}

// ─── Recommandations ───────────────────────────────────────────────────────

function CoachingCard({ item, data, userId, refresh, personId }: { item: PersonRecommendation; personId: string } & SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const feedback = async (type: 'useful' | 'incorrect') => run(`fb-${item.id}`, async () => {
    await savePersonRecommendationFeedback(data, item.id, userId, type)
    toast(type === 'useful' ? 'Merci — lecture confirmée.' : 'Pris en compte — cela affinera le profil.')
    await refresh()
  })
  return <article className="krs-card krs-posture krs-coaching kn-night" data-type="posture">
    <div className="krs-band" />
    <div className="krs-main">
      <div className="krs-head">
        <span className="krs-ic">{SparkIcon}</span>
        <span className="krs-type">Coaching</span>
        <span className="krs-sub">{item.category} · comment l’aborder</span>
      </div>
      <div className="krs-arch">{item.title.endsWith('.') ? item.title : `${item.title}.`} <b>{item.recommendedAction ?? ''}</b></div>
      {(item.leanOn.length > 0 || item.avoid.length > 0) && <>
        <div className="krs-socle-h">Socle observé</div>
        <div className="krs-grid">
          <div className="krs-col ok">
            <div className="krs-col-h">✓ S’appuyer sur</div>
            <div className="krs-col-body">{item.leanOn.map((line, index) => <div className="krs-li" key={index}>{line}</div>)}</div>
          </div>
          <div className="krs-col no">
            <div className="krs-col-h">✕ Éviter</div>
            <div className="krs-col-body">{item.avoid.map((line, index) => <div className="krs-li" key={index}>{line}</div>)}</div>
          </div>
        </div>
      </>}
      {item.evolutions.length > 0 && <>
        <div className="krs-evo-h">Ce qui évolue</div>
        <div className="krs-evo">
          {item.evolutions.map((evolution, index) => <div className="krs-evo-li" key={index} data-d={evolution.direction}>
            <span className={`krs-evo-tag ${evolution.direction}`}>{evolution.direction === 'new' ? '● nouveau' : evolution.direction === 'up' ? '↗ se renforce' : '↘ s’atténue'}</span>{evolution.text}
          </div>)}
        </div>
      </>}
      <div className="krs-evidence">{provenanceLabel(item.provenance)}{item.triggerSignal ? ` · ↳ ${item.triggerSignal}` : ''}</div>
      <div className="krs-foot">
        <Link className="krs-sim" to={`/app/ask?mode=simulation&personId=${personId}`}>▸ Simuler un échange</Link>
        {item.feedbackType
          ? <span className="krs-foot-q">Feedback enregistré — merci.</span>
          : <>
            <span className="krs-foot-q">Lecture juste ?</span>
            <button type="button" className="krs-b up" disabled={busy !== null} onClick={() => void feedback('useful')} aria-label="Utile">👍 Utile</button>
            <button type="button" className="krs-b dn" disabled={busy !== null} onClick={() => void feedback('incorrect')} aria-label="Pas juste">👎 Pas juste</button>
          </>}
      </div>
    </div>
  </article>
}

function ActionCard({ item, data, userId, refresh }: { item: PersonRecommendation } & SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const act = async (status: 'completed' | 'dismissed' | 'postponed') => run(`act-${item.id}`, async () => {
    const dueAt = status === 'postponed' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : undefined
    await updatePersonRecommendationStatus(data, item.id, userId, status, dueAt)
    toast(status === 'completed' ? 'Action marquée comme faite.' : status === 'postponed' ? 'Action reportée à 7 jours.' : 'Action écartée.')
    await refresh()
  })
  const kind = item.actionType === 'mouv' || /mouvement/i.test(item.actionType ?? '') ? 'mouv' : 'tache'
  return <article className="krs-card krs-action" data-type="action">
    <div className="krs-band" />
    <div className="krs-main">
      <div className="krs-crow">
        <span className="krs-ic">{BoltIcon}</span>
        <span className={`krs-kind ${kind}`}>{kind === 'mouv' ? 'Mouvement' : 'Tâche'}</span>
        <span className="krs-at">{item.title}</span>
        <span className="krs-prio">prio {item.priority}</span>
      </div>
      <div className="krs-aw">{item.justification}</div>
      <div className="krs-arow">
        <span className="krs-asig">{item.triggerSignal ? `↳ ${item.triggerSignal}` : provenanceLabel(item.provenance)}{item.dueAt ? ` · échéance ${formatDate(item.dueAt)}` : ''}</span>
        <span className="krs-do-inline">
          <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void act('completed')}>{CheckIcon} Juste</button>
          <button type="button" className="krs-b sm" disabled={busy !== null} onClick={() => void act('postponed')}>Reporter</button>
          <button type="button" className="krs-b sm no" disabled={busy !== null} onClick={() => void act('dismissed')} aria-label="Écarter">{CrossIcon}</button>
        </span>
      </div>
    </div>
  </article>
}

export function RecommendationsSection({ data, userId, refresh }: SectionProps) {
  const [filter, setFilter] = useState<'all' | 'posture' | 'action'>('all')
  const open = data.recommendations.filter((item) => item.status === 'open' || item.status === 'in_progress' || item.status === 'postponed')
  const coaching = open.filter((item) => item.kind === 'coaching')
  const actions = open.filter((item) => item.kind === 'action')
  const shown = filter === 'all' ? open : filter === 'posture' ? coaching : actions
  return <Csec id="sec-reco" className="reco-white" icon={SparkIcon} title="Recommandations">
    {!open.length
      ? <Empty title="Aucune recommandation ouverte">Tohu n’affiche pas de conseil générique : les recommandations apparaissent quand un signal déclencheur persisté les justifie.</Empty>
      : <>
        <div className="krs-pills" role="tablist" aria-label="Filtrer les recommandations">
          {([['all', 'Toutes'], ['posture', 'Posture'], ['action', 'Actions']] as const).map(([value, label]) =>
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={`krs-pill ${filter === value ? 'on' : ''}`} onClick={() => setFilter(value)}>{label}</button>)}
          <span className="krs-count">Actions : <b>{actions.length} ouverte{actions.length > 1 ? 's' : ''}</b></span>
        </div>
        <div className="krs-stack">
          {shown.map((item) => item.kind === 'coaching'
            ? <CoachingCard key={item.id} item={item} data={data} userId={userId} refresh={refresh} personId={data.person.id} />
            : <ActionCard key={item.id} item={item} data={data} userId={userId} refresh={refresh} />)}
        </div>
      </>}
  </Csec>
}

// ─── Profil comportemental ─────────────────────────────────────────────────

function confidenceDots(confidence: number | null): number {
  if (confidence === null) return 0
  const level = confidenceLevel(confidence)
  return level === 'élevé' ? 3 : level === 'moyen' ? 2 : 1
}

function BehaviorSlider({ label, left, right, theme }: { label: string; left: string; right: string; theme: PersonCognitiveTheme }) {
  const position = theme.score ?? 50
  return <div className="kslider">
    <div className="kfac-name">{label}</div>
    <div className="kslider-poles"><span className={theme.score !== null && position < 50 ? 'on' : ''}>{left}</span><span className={theme.score !== null && position >= 50 ? 'on' : ''}>{right}</span></div>
    <div className={`kslider-wrap ${theme.score === null ? 'locked' : ''}`} role="img" aria-label={theme.score === null ? `${label} : non observable à ce stade` : `${label} : ${theme.label ?? `${position}/100`}`}>
      <div className="kslider-track"><div className="kslider-half l" /><div className="kslider-half r" /></div>
      <div className="kslider-mid" />
      <div className="kslider-cursor" style={{ left: `${position}%` }} />
    </div>
  </div>
}

function BehaviorCircle({ data, assertiveness, warmth, proofOpen, toggleProof }: {
  data: PersonDetailData
  assertiveness: PersonCognitiveTheme
  warmth: PersonCognitiveTheme
  proofOpen: boolean
  toggleProof: () => void
}) {
  const neutral = assertiveness.score === null || warmth.score === null
  const horizontal = warmth.score ?? 50
  const vertical = 100 - (assertiveness.score ?? 50)
  const pointX = 80 + horizontal * 2
  const pointY = 50 + vertical * 2
  const quadrant = neutral ? 'en construction' : pointX < 180
    ? pointY < 150 ? 'Dominant' : 'Analytique'
    : pointY < 150 ? 'Influent' : 'Stable'

  return <div className="beh-circle">
    <div className="circ-wrap">
      <button type="button" className="proof-info" aria-expanded={proofOpen} onClick={toggleProof}>ⓘ Preuves</button>
      <div className={`proof-pop behavior-proof-pop ${proofOpen ? 'open' : ''}`} aria-hidden={!proofOpen}>
        <div className="proof-pop-h">🎙 Preuves — {data.behavior.evidences.length} fait{data.behavior.evidences.length > 1 ? 's' : ''} de langage sourcé{data.behavior.evidences.length > 1 ? 's' : ''}</div>
        {data.behavior.evidences.length
          ? data.behavior.evidences.slice(0, 6).map((evidence) => <div className="proof-item" key={evidence.id}>
            {evidence.trait && <div className="proof-beh">{evidence.trait}</div>}
            <div className="proof-model">{evidence.inferenceLevel ?? 'Observable'} · {evidence.sourceLabel}</div>
            <div className="proof-q">« {evidence.text} »</div>
            <div className="proof-src">{evidence.sourceLabel} · {formatDate(evidence.observedAt)}</div>
          </div>)
          : <div className="proof-item"><div className="proof-beh">Preuves détaillées en construction</div><div className="proof-q">Les verbatims apparaîtront après les prochaines synchronisations.</div></div>}
      </div>
      <svg className={`behavior-circle-svg ${neutral ? 'neutral' : ''}`} viewBox="0 0 360 312" role="img" aria-label={`Cercle interpersonnel : posture ${quadrant}${neutral ? '' : ', calculée à partir des échanges observés'}`}>
        <defs>
          <radialGradient id="behavior-sweep-gradient" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#6E50C8" stopOpacity=".20" /><stop offset="1" stopColor="#6E50C8" stopOpacity="0" /></radialGradient>
        </defs>
        <path d="M180,150 L180,50 A100,100 0 0,1 280,150 Z" fill="#FBF3E6" />
        <path d="M180,150 L180,50 A100,100 0 0,0 80,150 Z" fill="#F0EBFB" />
        <path d="M180,150 L280,150 A100,100 0 0,1 180,250 Z" fill="#E8F5EE" />
        <path d="M180,150 L80,150 A100,100 0 0,0 180,250 Z" fill="#E6F2F5" />
        <circle cx="180" cy="150" r="100" fill="none" stroke="#D8D1EC" strokeWidth="1" />
        <circle cx="180" cy="150" r="66" fill="none" stroke="#E2DCF1" strokeWidth="1" strokeDasharray="2 4" />
        <circle cx="180" cy="150" r="33" fill="none" stroke="#E2DCF1" strokeWidth="1" strokeDasharray="2 4" />
        {Array.from({ length: 12 }, (_, index) => {
          const angle = index * Math.PI / 6 - Math.PI / 2
          const x1 = 180 + Math.cos(angle) * 96
          const y1 = 150 + Math.sin(angle) * 96
          const x2 = 180 + Math.cos(angle) * 104
          const y2 = 150 + Math.sin(angle) * 104
          return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#CFC8E2" strokeWidth="1.1" />
        })}
        <path d="M180,150 L180,50 A100,100 0 0,1 230,63 Z" fill="url(#behavior-sweep-gradient)"><animateTransform attributeName="transform" type="rotate" from="0 180 150" to="360 180 150" dur="7s" repeatCount="indefinite" /></path>
        <line x1="180" y1="50" x2="180" y2="250" stroke="#D6D0E8" strokeWidth="1" />
        <line x1="80" y1="150" x2="280" y2="150" stroke="#D6D0E8" strokeWidth="1" />
        <text x="180" y="40" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="700" fill="#7B7398" letterSpacing="1">ASSERTIF ▲</text>
        <text x="180" y="276" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="700" fill="#7B7398" letterSpacing="1">▼ CONCILIANT</text>
        <text x="70" y="154" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="700" fill="#7B7398" letterSpacing="1">◀ DISTANT</text>
        <text x="290" y="154" textAnchor="start" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="700" fill="#7B7398" letterSpacing="1">CHALEUREUX ▶</text>
        <text x="40" y="60" textAnchor="middle" fontFamily="Epilogue, sans-serif" fontSize="13" fontWeight="800" fill="#6E50C8">Dominant</text>
        <text x="320" y="60" textAnchor="middle" fontFamily="Epilogue, sans-serif" fontSize="13" fontWeight="800" fill="#C97A20">Influent</text>
        <text x="40" y="248" textAnchor="middle" fontFamily="Epilogue, sans-serif" fontSize="13" fontWeight="800" fill="#2896A8">Analytique</text>
        <text x="320" y="248" textAnchor="middle" fontFamily="Epilogue, sans-serif" fontSize="13" fontWeight="800" fill="#2EA86A">Stable</text>
        <circle cx="180" cy="150" r="2.5" fill="#C4BCD8" />
        <ellipse cx={pointX} cy={pointY} rx="26" ry="22" fill="#6E50C8" fillOpacity=".10" stroke="#6E50C8" strokeWidth="1.3" strokeDasharray="4 3"><animate attributeName="stroke-opacity" values=".42;.16;.42" dur="3.2s" repeatCount="indefinite" /></ellipse>
        <circle cx={pointX} cy={pointY} r="8" fill="none" stroke="#6E50C8" strokeWidth="1.6"><animate attributeName="r" values="8;26" dur="2.6s" repeatCount="indefinite" /><animate attributeName="opacity" values=".55;0" dur="2.6s" repeatCount="indefinite" /></circle>
        <line x1="180" y1="150" x2={pointX} y2={pointY} stroke="#3C3489" strokeWidth="2.4" />
        <circle cx={pointX} cy={pointY} r="8" fill="#3C3489" stroke="#fff" strokeWidth="2.5" />
      </svg>
    </div>
  </div>
}

const BEHAVIOR_MARKERS = [
  { id: 'response_time', title: 'Temps de réponse', hint: 'Délai, cadence et réciprocité observés dans les fils de communication.' },
  { id: 'dominance_listening_speaking', title: 'Dominance · écoute ↔ parole', hint: 'Répartition entre écoute, prise de parole, cadrage et pilotage des échanges.' },
  { id: 'linguistic_synchrony', title: 'Synchronie linguistique', hint: 'Alignement du vocabulaire, du registre et des formulations entre interlocuteurs.' },
  { id: 'pronouns_status', title: 'Pronoms & statut', hint: 'Usage des pronoms et indices de positionnement statutaire dans les échanges.' },
  { id: 'register_distance', title: 'Registre & distance', hint: 'Niveau de formalisme, proximité, technicité et distance relationnelle observés.' },
  { id: 'self_disclosure', title: 'Auto-divulgation', hint: 'Profondeur du dévoilement personnel par rapport au contenu professionnel.' },
] as const

function behaviorSourceBadge(source: string): string {
  const normalized = source.toLocaleLowerCase('fr-FR')
  if (/read|transcript|meeting|visio/.test(normalized)) return '🎙 transcript'
  if (/outlook|gmail|mail|email/.test(normalized)) return '✉'
  return source
}

export function BehaviorSection({ data, manualSyncAction }: { data: PersonDetailData; manualSyncAction?: ReactNode }) {
  const behavior = data.behavior
  const profile = behavior.cognitiveProfile
  const [proofOpen, setProofOpen] = useState(false)
  const [markersOpen, setMarkersOpen] = useState(true)
  const evidenceThresholdReached = behavior.analyzedInteractions >= behavior.profileMinimumInteractions
  const hasProfile = evidenceThresholdReached && profile.schemaVersion >= 2
  const emerging = hasProfile && behavior.analyzedInteractions < behavior.minimumInteractions
  const styles = new Map(profile.exchangeStyles.map((theme) => [theme.id, theme]))
  const sliders = [
    { label: 'Tempo', left: 'Rapide', right: 'Analytique', theme: styles.get('tempo')! },
    { label: 'Ouverture', left: 'Innovant', right: 'Conforme', theme: styles.get('openness')! },
    { label: 'Orientation', left: 'Tâche', right: 'Relation', theme: styles.get('orientation')! },
    { label: 'Certitude', left: 'Nuancé', right: 'Tranché', theme: styles.get('certainty')! },
  ]
  const acts = new Map(profile.speechActs.map((theme) => [theme.id, theme]))
  const speechActs = [
    { id: 'directive', label: 'Directif', role: 'cadre', theme: acts.get('directive')! },
    { id: 'commissive', label: 'Commissif', role: 's’engage', theme: acts.get('commissive')! },
    { id: 'assertive', label: 'Assertif', role: 'factuel', theme: acts.get('assertive')! },
    { id: 'interrogative', label: 'Interrogatif', role: 'consulte', theme: acts.get('interrogative')! },
    { id: 'expressive', label: 'Expressif', role: 'engagé', theme: acts.get('expressive')! },
  ]
  const markerThemes = new Map(profile.observableMarkers.map((theme) => [theme.id, theme]))
  const markerCards = BEHAVIOR_MARKERS.map((definition) => ({ ...definition, theme: markerThemes.get(definition.id)! }))
  const postureText = profile.posture.observation
  const summaryText = behavior.executiveSummary

  return <Csec id="sec-profil" icon={CircleIcon} title="Profil comportemental · Cercle interpersonnel">
    {manualSyncAction && <div className="behavior-manual-sync">{manualSyncAction}</div>}
    {!hasProfile && <div className="behavior-insufficient" role="status">
      <span className="behavior-insufficient-icon" aria-hidden="true">◇</span>
      {evidenceThresholdReached
        ? <div><strong>Analyse cognitive en attente</strong><p>{behavior.analyzedInteractions} interactions attribuées — le profil structuré sera produit lors de la prochaine synchronisation des échanges.</p></div>
        : <div><strong>Analyse comportementale insuffisante</strong><p>{behavior.analyzedInteractions} interaction{behavior.analyzedInteractions > 1 ? 's' : ''} analysée{behavior.analyzedInteractions > 1 ? 's' : ''} — 3 sont nécessaires pour faire émerger un premier profil. Aucune personnalité n’est inférée sans preuves suffisantes.</p></div>}
    </div>}
    {emerging && <div className="behavior-insufficient" role="status">
      <span className="behavior-insufficient-icon" aria-hidden="true">◇</span>
      <div><strong>Profil émergent</strong><p>{behavior.analyzedInteractions} interactions analysées — fiabilité recommandée à partir de {behavior.minimumInteractions}. Seuls les thèmes soutenus par des preuves sont renseignés.</p></div>
    </div>}
    {hasProfile && <>
    <div className="beh-grid">
      <BehaviorCircle data={data} assertiveness={profile.interpersonal.assertiveness} warmth={profile.interpersonal.warmth} proofOpen={proofOpen} toggleProof={() => setProofOpen((value) => !value)} />
      <div className="beh-read">
        <div className="circ-cap"><b>{summaryText ?? 'Synthèse en attente de preuves convergentes.'}</b>{behavior.cognitiveMode && <> Mode dominant observé : {behavior.cognitiveMode}.</>}</div>
        <div className="beh-slabel">Style d’échange</div>
        <div className="beh-sliders">{sliders.map((slider) => <BehaviorSlider key={slider.label} {...slider} />)}</div>
      </div>
    </div>
    <div className="obs-div" />
    <button type="button" className={`obs-toggle ${markersOpen ? 'open' : ''}`} aria-expanded={markersOpen} aria-controls="obsCollapse" onClick={() => setMarkersOpen((value) => !value)}>
      <div className="obs-toggle-l">
        <span className="obs-toggle-ic" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18.5" cy="18" r="2.3" fill="#6E50C8" stroke="none" /></svg></span>
        <div>
          <div className="obs-toggle-t">Marqueurs observables · 7 faits de langage</div>
          <div className="obs-toggle-s">Temps de réponse, synchronie, pronoms, registre, auto-divulgation… les preuves derrière le profil.</div>
        </div>
      </div>
      <span className="obs-toggle-btn"><span className="obs-toggle-txt">{markersOpen ? 'Replier' : 'Déplier'}</span><span className="obs-chev">▾</span></span>
    </button>
    <div className="obs-collapse" id="obsCollapse" style={markersOpen ? { maxHeight: 3200 } : undefined}>
      <div className="obs-acts-h">Actes de langage · registre présent</div>
      <div className="speech-bands">
        {speechActs.map((act) => {
          const present = act.theme.status === 'observed'
          return <span className={`sband ${present ? 'on' : 'rare'}`} key={act.id} title={act.theme.observation ?? 'Non observable à ce stade'}><span className="sdot" /><b>{act.label}</b><span className="srole">{act.role}</span><span className="sstatus">{present ? 'présent' : act.theme.status === 'emerging' ? 'émergent' : 'à confirmer'}</span></span>
        })}
      </div>
      <div className="kobs-grid">
        {markerCards.map((marker) => <div className={`kobs-card ${marker.theme.status === 'insufficient' ? 'locked' : ''}`} key={marker.id}>
          <div className="kobs-top">
            <span className="kobs-n">{marker.title}<span className="ktip">ⓘ<span className="ktip-pop">{marker.hint}</span></span></span>
            <span className="kobs-src">{marker.theme.sourceTypes.length ? behaviorSourceBadge(marker.theme.sourceTypes.join(' + ')) : 'À confirmer'}</span>
          </div>
          <div className="kobs-v">{marker.theme.observation ?? 'Non observable à ce stade.'}</div>
          <div className="kobs-foot"><span className="kdots" aria-label={confidenceLevel(marker.theme.confidence) ? `Confiance ${confidenceLevel(marker.theme.confidence)}` : 'Confiance à confirmer'}>{[1, 2, 3].map((dot) => <span key={dot} className={`kdot ${dot <= confidenceDots(marker.theme.confidence) ? 'on' : ''}`} />)}</span></div>
        </div>)}
        <div className={`kobs-card kobs-nps behavior-posture-card ${postureText ? '' : 'locked'}`}>
          <div className="kobs-top"><span className="kobs-n">Posture</span><span className="kobs-src">synthèse ↦ Contexte</span></div>
          <div className="kobs-v">{postureText ?? 'Non observable à ce stade.'}</div>
          <div className="kobs-foot"><span className="knps prom">● {profile.posture.label ?? 'À confirmer'}</span></div>
        </div>
      </div>
    </div>
    </>}
  </Csec>
}
