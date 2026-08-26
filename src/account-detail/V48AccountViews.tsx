import { useMemo, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { initials } from '../lib/auth'
import { saveSignalFeedback } from '../services/data'
import { isBehavioralSignal, signalTypeLabel } from '../services/signal-labels'
import { addAccountNote, updateRecommendationStatus } from './service'
import type { AccountDetailData, AccountPerson, AccountSignal } from './types'

type ViewProps = {
  data: AccountDetailData
  userId: string
  refresh: () => Promise<void>
  navigate: (path: string) => void
}

function dateLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'À confirmer'
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function relativeLabel(value: string | null): string {
  if (!value) return 'jamais'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'à confirmer'
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  return days === 0 ? 'aujourd’hui' : `il y a ${days} j`
}

function Icon({ name }: { name: 'pulse' | 'strategy' | 'history' | 'sparkle' | 'people' | 'signal' | 'building' }) {
  const paths: Record<typeof name, ReactNode> = {
    pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
    strategy: <><path d="M5 19 19 5M8 5h11v11" /><circle cx="7" cy="17" r="3" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></>,
    people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3.5 20c.6-4 2.5-6 5.5-6s5 2 5.5 6M14 15c3.4-.4 5.5 1.2 6 4" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M9 21v-3h6v3" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SectionTitle({ icon, title, meta }: { icon: Parameters<typeof Icon>[0]['name']; title: string; meta?: ReactNode }) {
  return <header className="v48-section-title"><span><Icon name={icon} /></span><h2>{title}</h2>{meta && <div>{meta}</div>}</header>
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="v48-empty"><span>◇</span><p>{children}</p></div>
}

function ScoreChart({ data }: { data: AccountDetailData }) {
  const points = data.relationship.history
  if (points.length < 2) return <Empty>L’évolution du compte apparaîtra après plusieurs calculs persistés.</Empty>
  const width = 620
  const height = 180
  const pad = 22
  const x = (index: number) => pad + index * (width - pad * 2) / Math.max(1, points.length - 1)
  const y = (score: number) => pad + (100 - score) / 100 * (height - pad * 2)
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(item.score)}`).join(' ')
  return <svg className="v48-score-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={points.map((item) => `${dateLabel(item.computedAt)}: ${item.score}`).join(', ')}>
    {[25, 50, 75].map((value) => <line key={value} x1={pad} y1={y(value)} x2={width - pad} y2={y(value)} />)}
    <path d={path} />
    {points.map((item, index) => <circle key={`${item.computedAt}-${index}`} cx={x(index)} cy={y(item.score)} r={index === points.length - 1 ? 5 : 3} />)}
  </svg>
}

function PersonDistribution({ people }: { people: AccountPerson[] }) {
  const shown = [...people].filter((person) => person.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (!shown.length) return <Empty>Aucun score individuel mesurable n’est disponible pour ce compte.</Empty>
  return <div className="v48-account-distribution">
    {shown.map((person) => <div key={person.id}>
      <span>{person.name}</span>
      <i><b className={(person.score ?? 0) >= 70 ? 'good' : (person.score ?? 0) >= 50 ? 'mid' : 'low'} style={{ width: `${person.score}%` }} /></i>
      <strong>{person.score}</strong>
    </div>)}
    <footer><span><i className="low" />Détracteur ≤50</span><span><i className="mid" />Passif 50–69</span><span><i className="good" />Promoteur ≥70</span></footer>
  </div>
}

function Strategy({ data, userId, refresh }: Omit<ViewProps, 'navigate'>) {
  const [busy, setBusy] = useState<string | null>(null)
  const open = data.recommendations.filter((item) => item.status === 'open' || item.status === 'postponed')
  const act = async (id: string, status: 'completed' | 'dismissed' | 'postponed') => {
    setBusy(id)
    try {
      await updateRecommendationStatus(data, id, userId, status)
      await refresh()
    } finally {
      setBusy(null)
    }
  }
  return <section className="v48-section">
    <SectionTitle icon="strategy" title="Stratégie de compte" meta={<span className="v48-section-count"><b>{open.length}</b> actions</span>} />
    <div className="v48-strategy-list">
      {open.map((item) => <article key={item.id}>
        <div><span>{item.category}</span><b>P{item.priority}</b></div>
        <h3>{item.title}</h3>
        <p>{item.justification}</p>
        {item.recommendedAction && <strong>{item.recommendedAction}</strong>}
        <small>↳ {item.provenance.sourceLabel}{item.personName ? ` · ${item.personName}` : ''}</small>
        <footer>
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'completed')}>✓ Fait</button>
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'dismissed')}>× Pas juste</button>
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'postponed')}>Reporter</button>
        </footer>
      </article>)}
      {!open.length && <Empty>Aucune recommandation stratégique ouverte n’est étayée actuellement.</Empty>}
    </div>
  </section>
}

function AccountMemory({ data, userId, refresh }: Omit<ViewProps, 'navigate'>) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try {
      await addAccountNote(data, userId, content.trim())
      setContent('')
      await refresh()
    } finally {
      setSaving(false)
    }
  }
  const owners = [...new Set(data.people.map((person) => person.ownerName).filter(Boolean))]
  if (data.account.primaryOwnerName && !owners.includes(data.account.primaryOwnerName)) owners.push(data.account.primaryOwnerName)
  return <section className="v48-history-memory">
    <header><div><Icon name="history" /><h2>Historique &amp; mémoire du compte</h2></div><span>{data.memoryEntries.length} entrée{data.memoryEntries.length > 1 ? 's' : ''} en mémoire</span></header>
    <div className="v48-owner-relay">
      <small>Qui a porté la relation</small>
      <div>{owners.length ? owners.map((owner, index) => <span key={owner as string} className={index === owners.length - 1 ? 'current' : ''}><b>{initials(owner as string)}</b><strong>{owner}</strong>{index < owners.length - 1 && <i>→</i>}</span>) : <em>Owner à confirmer</em>}</div>
    </div>
    <div className="v48-history-kpis">
      <div><strong>{dateLabel(data.account.relationshipStartedAt)}</strong><span>Premier échange</span></div>
      <div><strong>{data.relationship.totalInteractions || '—'}</strong><span>Échanges au total</span></div>
      <div><strong>{data.people.length}</strong><span>Interlocuteurs actifs</span></div>
    </div>
    <div className="v48-memory-list">
      {data.memoryEntries.slice(0, 6).map((entry) => <article key={entry.id}><span>{dateLabel(entry.createdAt)}</span><div><strong>{entry.content}</strong><small>{entry.entryType} · {entry.authorName}</small></div></article>)}
      {!data.memoryEntries.length && <Empty>L’histoire du compte se construira à partir des interactions, signaux et notes persistés.</Empty>}
    </div>
    <form className="v48-memory-form" onSubmit={(event) => void submit(event)}>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ajouter un contexte, une décision ou un engagement…" />
      <button disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>
  </section>
}

export function V48AccountRelationView(props: ViewProps) {
  const { data } = props
  const delta = data.relationship.phaseDelta
  return <div className="v48-account-relation">
    <div className="v48-relation-columns">
      <section className="v48-section">
        <SectionTitle icon="pulse" title="Santé du compte" meta={<span className={`v48-evolution ${delta !== null && delta < 0 ? 'down' : 'up'}`}>{delta === null ? 'variation indisponible' : `${delta >= 0 ? '↗ +' : '↘ '}${delta} pts`}</span>} />
        <div className="v48-score-lead"><strong>{data.relationship.score ?? '—'}</strong><div><span>NPS compte · roll-up</span><p>Agrégation des liens individuels mesurables. Ce score décrit la solidité du réseau relationnel, pas la satisfaction déclarée.</p></div></div>
        <ScoreChart data={data} />
        <p className="v48-overline">Répartition par interlocuteur</p>
        <PersonDistribution people={data.people} />
        <div className="v48-live-sync"><i />Dernière synchronisation : {relativeLabel(data.relationship.computedAt)}</div>
      </section>
      <Strategy data={data} userId={props.userId} refresh={props.refresh} />
    </div>
    <AccountMemory data={data} userId={props.userId} refresh={props.refresh} />
  </div>
}

function AccountInsight({ data }: { data: AccountDetailData }) {
  const signal = data.signals.find((item) => !isBehavioralSignal(item.type)) ?? data.signals[0]
  // Sous-encart daté de la carte gauche : un signal notable distinct du spotlight.
  const nested = data.signals.find((item) => item.id !== signal?.id) ?? null
  const lead = [...data.people].sort((a, b) => (b.exchangeShare ?? 0) - (a.exchangeShare ?? 0))[0]
  const reading = data.account.description
    || (lead ? `La relation est principalement portée par ${lead.name}${lead.exchangeShare === null ? '' : `, qui représente ${lead.exchangeShare}% des échanges observés`}.` : null)
    || 'La lecture du compte est encore en construction.'
  const sources = data.sources.map((source) => source.label).join(' + ') || 'sources à confirmer'
  return <div className="v48-insight-grid">
    <article className="v48-insight filled">
      <div className="v48-insight-head"><span className="v48-insight-ic"><Icon name="people" /></span><small>Ce que montrent les échanges</small></div>
      <strong>{reading}</strong>
      {nested && <div className="v48-insight-nested">
        <small>{relativeLabel(nested.provenance.observedAt)}</small>
        <b>{nested.title}</b>
        {(nested.summary || nested.impact) && <p>{nested.summary || nested.impact}</p>}
      </div>}
      <p className="v48-insight-src">Dérivé de {data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} · {sources}</p>
    </article>
    <article className="v48-signal-spotlight"><small>Depuis votre dernier échange <b>{dateLabel(data.relationship.lastInteractionAt)}</b></small>
      {signal ? <><span>{signalTypeLabel(signal.type)}</span><strong>{signal.title}</strong><p>{signal.summary || signal.impact || 'Signal détecté, détail en cours de consolidation.'}</p><em>{signal.provenance.sourceLabel} · {relativeLabel(signal.provenance.observedAt)}</em></>
        : <p>Aucun nouveau signal réel depuis le dernier échange.</p>}
    </article>
  </div>
}

// Rôle d'interlocuteur → libellé maquette (Décideur, Filtre, Prescripteur, Utilisateur…).
const ROLE_LABELS: Record<string, string> = {
  decision_maker: 'Décideur', decideur: 'Décideur', economic_buyer: 'Décideur',
  gatekeeper: 'Filtre · Gatekeeper', filtre: 'Filtre · Gatekeeper',
  influencer: 'Prescripteur · Influenceur', prescripteur: 'Prescripteur · Influenceur', prescriber: 'Prescripteur · Influenceur',
  user: 'Utilisateur', utilisateur: 'Utilisateur', end_user: 'Utilisateur',
  champion: 'Champion', sponsor: 'Sponsor', buyer: 'Acheteur', technical: 'Référent technique',
}
function roleLabel(person: AccountPerson): string {
  const raw = person.decisionRole || person.relationshipRole || person.organizationalRole
  if (!raw) return 'Interlocuteur'
  return ROLE_LABELS[raw.toLowerCase()] ?? raw.replaceAll('_', ' ')
}

// Catégorie d'un signal → tag + tonalité (couleur du liseré), dérivée du type réel.
function signalCategory(signal: AccountSignal): { tag: string; tone: 'friction' | 'positive' | 'external' | 'internal' | 'context' } {
  const hay = `${signal.type} ${signal.provenance.sourceType} ${signal.impact ?? ''}`.toLowerCase()
  if (/friction|risk|risque|churn|silence|retard|perdu|tension|deadline|échéance|impayé|litige/.test(hay)) return { tag: 'Friction', tone: 'friction' }
  if (/opportun|reprise|growth|win|renforce|levée|funding|expansion|signature/.test(hay)) return { tag: 'Opportunité', tone: 'positive' }
  if (/pappers|rcs|registre|news|press|monitoring|veille|mobility|job|externe|linkedin|nomination|gouvernance/.test(hay)) return { tag: 'Externe', tone: 'external' }
  if (isBehavioralSignal(signal.type)) return { tag: 'Interne', tone: 'internal' }
  return { tag: 'Contexte', tone: 'context' }
}

// Action contextuelle : n'apparaît que si une vraie URL source existe.
function signalAction(signal: AccountSignal): { label: string; url: string } | null {
  const url = signal.provenance.sourceUrl
  if (!url) return null
  const label = signal.provenance.sourceLabel ?? ''
  if (/pappers|rcs/i.test(label)) return { label: 'Ouvrir la fiche Pappers →', url }
  if (/outlook|gmail|mail|email/i.test(label)) return { label: 'Ouvrir le mail →', url }
  return { label: 'Ouvrir la source →', url }
}

function OrgGrid({ people, navigate }: { people: AccountPerson[]; navigate: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(() => [...people].sort((a, b) => (b.exchangeShare ?? -1) - (a.exchangeShare ?? -1)), [people])
  const shown = expanded ? sorted : sorted.slice(0, 4)
  const rest = sorted.length - shown.length
  return <section className="v48-section">
    <SectionTitle icon="people" title="Organigramme" meta={<span className="v48-section-count"><b>{sorted.length}</b> actif{sorted.length > 1 ? 's' : ''}</span>} />
    {!sorted.length ? <Empty>Aucun interlocuteur réel n’est encore rattaché à ce compte.</Empty> :
      <div className="v48-orgc-grid">{shown.map((person) => {
        const tone = person.score !== null && person.score >= 70 ? '#2ea86a' : person.score !== null && person.score < 50 ? '#d94f63' : '#6e50c8'
        return <button className="v48-orgc" key={person.id} onClick={() => navigate(`/app/people/${person.id}`)} style={{ '--person-tone': tone } as CSSProperties}>
          <span className="v48-orgc-tag">{roleLabel(person)}</span>
          <strong className="v48-orgc-name">{person.name}</strong>
          <span className="v48-orgc-share">{person.exchangeShare === null ? 'part à confirmer' : <><b>{person.exchangeShare}%</b> des échanges</>}</span>
          {person.jobTitle && <p className="v48-orgc-fn">{person.jobTitle}</p>}
          <footer><span>{person.exchangeShare === null ? 'À confirmer' : 'Vos échanges · Observable'}</span><i>→</i></footer>
        </button>
      })}</div>}
    {rest > 0 && <button type="button" className="v48-more" onClick={() => setExpanded(true)}>Voir {rest} interlocuteur{rest > 1 ? 's' : ''} de plus ▾</button>}
    {expanded && sorted.length > 4 && <button type="button" className="v48-more" onClick={() => setExpanded(false)}>Réduire ▴</button>}
  </section>
}

function Firmographics({ data }: { data: AccountDetailData }) {
  return <details className="v48-detail-fold v48-firmographics">
    <summary><Icon name="building" /><strong>Firmographie</strong><span>{data.firmographics.length} données sourcées</span><b>⌄</b></summary>
    <div className="v48-firmographic-grid">
      {data.firmographics.map((fact) => <article key={fact.id}><span>{fact.key.replaceAll('_', ' ')}</span><strong>{typeof fact.value === 'string' || typeof fact.value === 'number' ? String(fact.value) : JSON.stringify(fact.value)}</strong><small>{fact.provenance.sourceLabel} · {dateLabel(fact.provenance.lastVerifiedAt || fact.provenance.observedAt)}</small></article>)}
      {!data.firmographics.length && <Empty>Aucune donnée société vérifiée n’est disponible.</Empty>}
    </div>
  </details>
}

function SignalFeed({ data, userId, refresh, openWatch }: Omit<ViewProps, 'navigate'> & { openWatch: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const validate = async (id: string, verdict: 'confirmed' | 'dismissed') => {
    setBusy(id)
    try {
      await saveSignalFeedback(id, userId, verdict)
      await refresh()
    } finally {
      setBusy(null)
    }
  }
  const lastSync = useMemo(() => data.sources.map((source) => source.lastSyncedAt).filter((value): value is string => value !== null).sort().pop() ?? data.relationship.computedAt, [data])
  const shown = expanded ? data.signals : data.signals.slice(0, 4)
  const rest = data.signals.length - shown.length
  return <section className="v48-section v48-signals">
    <SectionTitle icon="signal" title="Signaux récents" meta={<><button type="button" className={`v48-watch-pill ${data.account.watchEnabled ? 'on' : ''}`} onClick={openWatch} title="Gérer la veille"><i />Veille {data.account.watchEnabled ? 'active' : 'coupée'}</button><span className="v48-section-count"><b>{data.signals.length}</b></span></>} />
    {data.account.watchEnabled
      ? <div className="v48-signals-sync"><i />Dernière synchronisation : <b>{relativeLabel(lastSync)}</b></div>
      : <div className="v48-signals-sync off"><i />Veille coupée — aucun nouveau signal ne sera collecté.</div>}
    <div className="v48-sig-list">
      {shown.map((signal) => {
        const cat = signalCategory(signal)
        const action = signalAction(signal)
        return <article className={`v48-sig tone-${cat.tone}`} key={signal.id}>
          <div className="v48-sig-rail"><span className="v48-sig-when">{relativeLabel(signal.provenance.observedAt)}</span><i className="v48-sig-dot" /></div>
          <div className="v48-sig-body">
            <div className="v48-sig-head"><h3>{signal.title}</h3><span className="v48-sig-cat">{cat.tag}</span></div>
            <p>{signal.summary || signal.impact || 'Détail en cours de consolidation.'}</p>
            <div className="v48-sig-foot">
              {signal.provenance.sourceLabel && <span className="v48-sig-chan"><i />{signal.provenance.sourceLabel}</span>}
              {action && <a className="v48-sig-open" href={action.url} target="_blank" rel="noreferrer">{action.label}</a>}
              <span className="v48-sig-acts">
                <button className={signal.validationStatus === 'confirmed' ? 'on' : ''} disabled={busy === signal.id} onClick={() => void validate(signal.id, 'confirmed')} title="Confirmer">✓</button>
                <button className={signal.validationStatus === 'dismissed' ? 'on no' : 'no'} disabled={busy === signal.id} onClick={() => void validate(signal.id, 'dismissed')} title="Infirmer">×</button>
              </span>
            </div>
          </div>
        </article>
      })}
      {!data.signals.length && <Empty>Aucun signal réel n’est actuellement rattaché à ce compte.</Empty>}
    </div>
    {rest > 0 && <button type="button" className="v48-more" onClick={() => setExpanded(true)}>Voir {rest} signal{rest > 1 ? 'aux' : ''} de plus ▾</button>}
    {expanded && data.signals.length > 4 && <button type="button" className="v48-more" onClick={() => setExpanded(false)}>Réduire ▴</button>}
  </section>
}

export function V48AccountLiveView(props: ViewProps & { openWatch: () => void }) {
  return <div className="v48-account-live">
    <AccountInsight data={props.data} />
    <div className="v48-account-live-grid">
      <div className="v48-live-col">
        <OrgGrid people={props.data.people} navigate={props.navigate} />
        <Firmographics data={props.data} />
      </div>
      <div className="v48-live-col">
        <SignalFeed data={props.data} userId={props.userId} refresh={props.refresh} openWatch={props.openWatch} />
      </div>
    </div>
  </div>
}

export function V48AccountSourceNote({ data }: { data: AccountDetailData }) {
  return <footer className="v48-source-note">{data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} analysé{data.relationship.totalInteractions > 1 ? 's' : ''} · calculé {dateLabel(data.generatedAt)}{data.account.websiteUrl && <> · <a href={data.account.websiteUrl} target="_blank" rel="noreferrer">{data.account.domain || data.account.name}</a></>}</footer>
}
