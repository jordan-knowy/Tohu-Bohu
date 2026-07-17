import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { scoreWindow } from './mapping'
import { savePersonRecommendationFeedback, updatePersonRecommendationStatus } from './service'
import type { PersonDetailData, PersonRecommendation } from './types'
import { Csec, Empty, Prov, formatDate, formatMonth, phaseLabel, provenanceLabel, relativeDate, scoreTone, seniorityLabel, useBusy, useToast } from './ui'

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

  return <Csec id="sec-mem" icon={WaveIcon} title="Notre relation">
    <div className="es-stats" style={{ padding: '2px 0 6px', gap: 30, display: 'flex', flexWrap: 'wrap' }}>
      <div>
        <div className="es-l">Score relationnel</div>
        <div className="es-n" style={{ color: scoreTone(relation.score) }}>
          {relation.score ?? '—'}
          <span className="ic" tabIndex={0}>i<span className="tip">
            <span className="tip-h">Comment c’est calculé</span>
            Score composite produit par le moteur relationnel backend (intensité · réciprocité · récence). Échelle 0–100. Le front n’effectue aucun calcul.
            <span className="tip-f">{relation.computedAt ? `Calculé le ${formatDate(relation.computedAt)}` : 'En attente du moteur backend.'}</span>
          </span></span>
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
          <div className="nps-title">Courbe du score — <b>{months} mois</b>{delta !== null && <> (<b>{delta >= 0 ? `↗ +${delta}` : `↘ ${delta}`}</b>)</>}</div>
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
                    <div className="tt-r">{[point.phase ? phaseLabel(point.phase) : null, point.interactionCount !== null ? `${point.interactionCount} interactions` : null, point.confidence !== null ? `confiance ${Math.round(point.confidence)}%` : null].filter(Boolean).join(' · ') || 'Snapshot persisté.'}</div>
                  </>
                })()}
              </div>}
            </div>
            <div className="nps-leg">
              <span className="cl-item"><span className="cl-dot" style={{ background: 'var(--violet)' }} />Score du mois</span>
              <span className="cl-item"><span className="cl-dot" style={{ background: 'var(--sage)' }} />Mois courant</span>
              <span className="cl-item"><span className="cl-dot" style={{ background: '#E6E1F2' }} />Sans donnée</span>
            </div>
          </>}
        {hasDims
          ? <div className="mem-dims">
            {dims.map((dim) => dim.value !== null && <div className="dim-card" key={dim.label}>
              <div className="dim-lbl">{dim.label}</div>
              <div className="dim-val" style={{ color: scoreTone(dim.value) }}>{Math.round(dim.value)}<span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>/100</span></div>
              <div className="bar-track" style={{ margin: '4px 0 7px' }}><div className="bar-fill" style={{ width: `${dim.value}%`, background: scoreTone(dim.value) }} /></div>
              <div className="dim-note">{dim.note}</div>
              <Prov items={['Moteur relationnel · Inféré']} />
            </div>)}
          </div>
          : <div className="pp-note">Dimensions (intensité · réciprocité · récence) indisponibles — elles apparaîtront quand le moteur relationnel backend aura produit un snapshot dimensionné.</div>}
      </>}
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
  return <article className="krs-card krs-posture krs-coaching" data-type="posture">
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
          <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void act('completed')}>{CheckIcon} Fait</button>
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
  return <Csec id="sec-reco" icon={SparkIcon} title="Recommandations">
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
  if (confidence === null) return 1
  return confidence >= 70 ? 3 : confidence >= 40 ? 2 : 1
}

export function BehaviorSection({ data }: { data: PersonDetailData }) {
  const behavior = data.behavior
  const [proofOpen, setProofOpen] = useState(false)
  const insufficient = behavior.analyzedInteractions < behavior.minimumInteractions || !behavior.insights.length
  return <Csec id="sec-profil" icon={CircleIcon} title="Profil comportemental" meta={behavior.globalConfidence !== null ? <span className="csec-conf">confiance {Math.round(behavior.globalConfidence)}%</span> : undefined}>
    {insufficient
      ? <Empty title="Analyse comportementale insuffisante">
        {behavior.analyzedInteractions} interaction{behavior.analyzedInteractions > 1 ? 's' : ''} analysée{behavior.analyzedInteractions > 1 ? 's' : ''} — minimum recommandé : {behavior.minimumInteractions}. Le profil se construira au fil des synchronisations ; aucune personnalité n’est inférée sans preuves suffisantes.
      </Empty>
      : <>
        {behavior.executiveSummary && <div className="circ-cap" style={{ marginBottom: 14 }}>Dans les échanges observés : <b>{behavior.executiveSummary}</b></div>}
        {behavior.cognitiveMode && <div className="pp-note" style={{ marginBottom: 12 }}>Mode dominant observé : <b>{behavior.cognitiveMode}</b> — formulation prudente, jamais un diagnostic de personnalité.</div>}
        <div className="kobs-grid">
          {behavior.insights.map((insight) => <div className="kobs-card" key={insight.id}>
            <div className="kobs-top">
              <span className="kobs-n">{insight.trait}</span>
              <span className="kobs-src">{insight.provenance.sourceLabel}</span>
            </div>
            <div className="kobs-v">{insight.observation}</div>
            <div className="kobs-foot">
              <span className="kdots" aria-label={insight.confidence === null ? 'Confiance à confirmer' : `Confiance ${Math.round(insight.confidence)}%`}>
                {[1, 2, 3].map((dot) => <span key={dot} className={`kdot ${dot <= confidenceDots(insight.confidence) ? 'on' : ''}`} />)}
              </span>
              {insight.confidence !== null && <span className="kobs-src">{Math.round(insight.confidence)}%</span>}
            </div>
          </div>)}
        </div>
        <div className="obs-div" />
        <button type="button" className="obs-toggle" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} aria-expanded={proofOpen} onClick={() => setProofOpen((value) => !value)}>
          <div className="obs-toggle-l">
            <div>
              <div className="obs-toggle-t">Preuves · {behavior.evidences.length} fait{behavior.evidences.length > 1 ? 's' : ''} de langage observé{behavior.evidences.length > 1 ? 's' : ''}</div>
              <div className="obs-toggle-s">Chaque lecture s’appuie sur des observations sourcées — jamais de trait sans preuve.</div>
            </div>
          </div>
          <span className="obs-toggle-btn"><span className="obs-toggle-txt">{proofOpen ? 'Replier' : 'Déplier'}</span><span className="obs-chev">▾</span></span>
        </button>
        {proofOpen && <div className="obs-collapse" style={{ maxHeight: 'none' }}>
          {behavior.evidences.length
            ? <div className="proof-pop pp-proof-inline">
              {behavior.evidences.map((evidence) => <div className="proof-item" key={evidence.id}>
                {evidence.trait && <div className="proof-beh">{evidence.trait}</div>}
                <div className="proof-q">« {evidence.text} »</div>
                <div className="proof-src">{evidence.sourceLabel} · {formatDate(evidence.observedAt)}{evidence.confidence !== null ? ` · confiance ${Math.round(evidence.confidence)}%` : ''} · {evidence.inferenceLevel ?? 'observé'}</div>
              </div>)}
            </div>
            : <Empty title="Aucune preuve détaillée">Les verbatims sourcés apparaîtront après les prochaines synchronisations.</Empty>}
        </div>}
        <Prov items={[`Analyse mise à jour ${behavior.updatedAt ? `le ${formatDate(behavior.updatedAt)}` : 'à confirmer'}`, `${behavior.analyzedInteractions} échanges analysés`]} />
      </>}
  </Csec>
}
