import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { initials } from '../lib/auth'
import { confidenceLevel } from '../person-detail/ui'
import { saveSignalFeedback } from '../services/data'
import { verifySuperAdmin } from '../super-admin/service'
import {
  addAccountNote,
  getAccountDetail,
  setAccountArchived,
  setAccountFavorite,
  setAccountLock,
  setAccountWatch,
  triggerAccountEnrichment,
  updateRecommendationStatus,
} from './service'
import type { AccountDetailData, AccountPerson, Provenance } from './types'

type PageContext = { session: Session; workspaceId: string }

const WATCH_FAMILIES = ['gouvernance', 'dirigeants', 'recrutements', 'événements légaux', 'financement', 'presse', 'appels d’offres', 'renouvellements', 'signaux métier', 'changements d’interlocuteurs']
const FACT_LABELS: Record<string, string> = {
  legal_name: 'Raison sociale',
  registration_number: 'Identifiant légal',
  legal_form: 'Forme juridique',
  capital: 'Capital',
  naf_code: 'Code NAF',
  activity: 'Activité',
  address: 'Adresse',
  executives: 'Dirigeant',
  employee_range: 'Effectif',
  revenue: 'Chiffre d’affaires',
  profit: 'Résultat',
  fundraising_status: 'Levée',
  country: 'Pays',
}

function formatDate(value: string | null, fallback = 'À confirmer'): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : fallback
}

function relativeDate(value: string | null): string {
  if (!value) return 'Aucun contact'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? 'Aujourd’hui' : `Il y a ${days} j`
}

function tenureLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const start = new Date(value)
  if (!Number.isFinite(start.getTime())) return 'À confirmer'
  const months = Math.max(0, Math.floor((Date.now() - start.getTime()) / 2_629_746_000))
  if (months < 12) return `${months} mois`
  const years = months / 12
  return `~ ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: years < 5 ? 1 : 0 }).format(years)} ans`
}

function scoreLabel(score: number | null): string {
  return score === null ? 'Données insuffisantes' : score >= 70 ? 'Relation solide' : score >= 50 ? 'Relation à consolider' : 'Relation fragile'
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'À confirmer'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(valueLabel).join(', ')
  return JSON.stringify(value)
}

function provenanceLabel(item: Provenance): string {
  const freshness = item.lastVerifiedAt ?? item.observedAt
  return `${item.sourceLabel}${freshness ? ` · ${formatDate(freshness)}` : ''}${confidenceLevel(item.confidence) ? ` · confiance ${confidenceLevel(item.confidence)}` : ''}${item.inferenceLevel ? ` · ${item.inferenceLevel}` : ''}`
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ra-empty"><span>◇</span><strong>{title}</strong><p>{children}</p></div>
}

type IconName = 'pulse' | 'people' | 'bolt' | 'clock' | 'building' | 'signal' | 'share' | 'lock' | 'sparkles' | 'ask' | 'trash' | 'restore'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    pulse: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
    people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3.5 20c.6-4 2.5-6 5.5-6s5 2 5.5 6M14 15c3.4-.4 5.5 1.2 6 4" /></>,
    bolt: <path d="M13 2 4.5 13.5H11L10 22 19.5 10H13Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M9 21v-3h6v3" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
    share: <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" /><path d="m8.2 10.9 7-3.6m-7 5.8 7 3.6" /></>,
    lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></>,
    ask: <><path d="M4 5.5h16v11H9l-5 4v-15Z" /><path d="M9.5 10a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 3m0 1.8v.2" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
    restore: <><path d="M4 4v6h6" /><path d="M4.5 13a8 8 0 1 0 2-8.5L4 10" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SourceIcon({ provider, label }: { provider: string; label: string }) {
  const key = `${provider} ${label}`.toLowerCase()
  if (/outlook|microsoft/.test(key)) return <span className="src-provider outlook" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></svg></span>
  if (/read.?ai/.test(key)) return <span className="src-provider readai" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /></svg></span>
  if (/linkedin/.test(key)) return <span className="src-provider linkedin" aria-hidden="true">in</span>
  if (/web|internet|enrich/.test(key)) return <span className="src-provider internet" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></svg></span>
  return <span className="src-provider generic" aria-hidden="true">{initials(label).slice(0, 2)}</span>
}

function Section({ id, title, children, defaultOpen = true, icon = 'pulse', className = '' }: {
  id: string
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
  icon?: IconName
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`csec ${open ? 'open' : ''} ${className}`} id={id}>
    <button className="csec-header" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((value) => !value)}>
      <span className="csec-icon"><Icon name={icon} /></span>
      <span className="csec-title">{title}</span>
      <span className="csec-live"><Icon name="pulse" /> Live</span>
      <span className="csec-chevron" aria-hidden="true">▼</span>
    </button>
    <div className="csec-body" id={`${id}-body`}><div className="csec-inner">{children}</div></div>
  </section>
}

function scorePosition(score: number): number {
  return Math.max(0, Math.min(100, (score - 40) / 40 * 100))
}

function scoreColor(score: number): string {
  return score >= 70 ? 'var(--sage)' : score >= 50 ? 'var(--amber)' : 'var(--coral)'
}

function Health({ data }: { data: AccountDetailData }) {
  const relation = data.relationship
  const scoredPeople = data.people.filter((person) => person.score !== null)
  const average = scoredPeople.length
    ? Math.round(scoredPeople.reduce((sum, person) => sum + (person.score ?? 0), 0) / scoredPeople.length)
    : relation.score
  return <Section id="account-health" title="Santé du compte" icon="pulse">
    <div className="account-health-stats es-row">
      <div><div className="es-l">NPS compte (roll-up)</div><div className="es-n account-nps">{relation.score ?? '—'}</div></div>
      <div><div className="es-l">Ancienneté relation</div><div className="es-n">{tenureLabel(data.account.relationshipStartedAt)}</div></div>
      <div><div className="es-l">Échanges</div><div className="es-n account-exchanges">{relation.totalInteractions}</div></div>
    </div>
    {scoredPeople.length ? <div className="kfr2" aria-label="Répartition des scores relationnels">
      <div className="kfr2-inner">
        <div className="kfr2-plot">
          <div className="kfr2-zones"><span className="kfr2-z det" style={{ width: '25%' }} /><span className="kfr2-z pas" style={{ width: '50%' }} /><span className="kfr2-z pro" style={{ width: '25%' }} /></div>
          <div className="kfr2-axis" />
          {average !== null && <span className="kfr2-avg" style={{ left: `${scorePosition(average)}%` }}><span className="kfr2-avg-l">moy. {average}</span></span>}
          {scoredPeople.map((person) => <button
            className="kfr2-pt"
            key={person.id}
            style={{ left: `${scorePosition(person.score ?? 40)}%`, '--c': scoreColor(person.score ?? 40) } as CSSProperties}
            title={`${person.name} · ${person.score}`}
          >
            <span className="kfr2-pn">{person.name.split(' ')[0]}</span><span className="kfr2-pd" /><span className="kfr2-pv">{person.score}</span>
          </button>)}
        </div>
        <div className="kfr2-ticks">{[40, 50, 60, 70, 80].map((tick) => <span key={tick} style={{ left: `${scorePosition(tick)}%` }}>{tick}</span>)}</div>
        <div className="kfr2-zl"><span className="det" style={{ left: '12.5%' }}>Détracteur &lt;50</span><span className="pas" style={{ left: '50%' }}>Passif 50–69</span><span className="pro" style={{ left: '87.5%' }}>Promoteur ≥70</span></div>
      </div>
      <div className="kfr2-leg"><span className="cl-item"><i className="cl-dot" style={{ background: 'var(--sage)' }} />Promoteur ≥70</span><span className="cl-item"><i className="cl-dot" style={{ background: 'var(--amber)' }} />Passif 50–69</span><span className="cl-item"><i className="cl-dot" style={{ background: 'var(--coral)' }} />Détracteur &lt;50</span></div>
    </div> : <Empty title="Scores individuels indisponibles">Les scores apparaîtront ici dès que le moteur relationnel aura suffisamment de données.</Empty>}
    <div className="nps-live"><span className="nps-live-txt"><span className="live-ic"><Icon name="pulse" /></span> Mise à jour à chaque échange · dernier calcul {relativeDate(relation.computedAt).toLowerCase()}</span></div>
  </Section>
}

function PeopleMap({ people, navigate }: { people: AccountPerson[]; navigate: (path: string) => void }) {
  const shown = useMemo(() => [...people].sort((a, b) => {
    const decisionDelta = Number(Boolean(b.decisionRole)) - Number(Boolean(a.decisionRole))
    return decisionDelta || (b.exchangeShare ?? -1) - (a.exchangeShare ?? -1)
  }).slice(0, 5), [people])
  const positions = [
    { left: 205, top: 6 },
    { left: 6, top: 175 },
    { left: 404, top: 175 },
    { left: 6, top: 340 },
    { left: 404, top: 340 },
  ]
  return <Section id="account-people" title="Organigramme Live" icon="share">
    {!shown.length ? <Empty title={people.length ? 'Rôles de pouvoir non qualifiés' : 'Aucun interlocuteur lié'}>{people.length ? 'Les rôles décisionnels doivent être confirmés et persistés.' : 'Ajoute ou rattache un contact réel à ce compte.'}</Empty> :
      <div className="korg-wrap"><div className="korg m-sante">
        <svg className="korg-lines" viewBox="0 0 600 445" preserveAspectRatio="none" aria-hidden="true"><g stroke="#C9BEE8" strokeWidth="1.5" fill="none"><path d="M300 101 L300 130" /><path d="M101 130 L499 130" /><path d="M101 130 L101 175" /><path d="M499 130 L499 175" /><path d="M101 270 L101 340" /><path d="M499 270 L499 340" /></g></svg>
        {shown.map((person, index) => <button
          type="button"
          className="knode"
          data-s={person.score !== null && person.score >= 60 ? 'tenu' : 'faible'}
          data-p={person.decisionRole ? 'fort' : person.relationshipRole ? 'moyen' : 'faible'}
          style={{ left: positions[index]?.left ?? 6, top: positions[index]?.top ?? 340, '--nc': scoreColor(person.score ?? 50), '--nc-s': 'var(--violet-s)' } as CSSProperties}
          key={person.id}
          onClick={() => navigate(`/app/people/${person.id}`)}
        >
          <span className="knode-hd">
            <span className="knode-ic"><Icon name={person.decisionRole ? 'building' : 'people'} /></span>
            <span className="knode-nm"><span className="knode-n">{person.name}</span><span className="knode-fn">{person.jobTitle ?? 'Fonction à confirmer'}</span></span>
            <span className={`knode-sc ${person.score === null ? 'na' : ''}`}>{person.score ?? '—'}</span>
          </span>
          <span className="knode-ft"><span className={`knode-taxo ${person.decisionRole ? 'pw-fort' : person.relationshipRole ? 'pw-moyen' : 'pw-faible'}`}>{person.decisionRole ?? person.relationshipRole ?? 'Rôle à confirmer'}</span></span>
        </button>)}
      </div></div>}
  </Section>
}

function TeamMemory({ data }: { data: AccountDetailData }) {
  const owners = [...new Set(data.people.map((person) => person.ownerName).filter((owner): owner is string => Boolean(owner)))]
  if (data.account.primaryOwnerName && !owners.includes(data.account.primaryOwnerName)) owners.push(data.account.primaryOwnerName)
  const shown = owners.length ? owners : [data.account.primaryOwnerName ?? 'Owner à confirmer']
  return <Section id="account-team-memory" title="Mémoire d’équipe" icon="people">
    <div className="kmem-track">{shown.map((owner, index) => <div className="account-memory-step" key={`${owner}-${index}`}>
      {index > 0 && <span className="kmem-arrow" aria-hidden="true">→</span>}
      <div className={`kmem-step ${index === shown.length - 1 ? 'cur' : ''}`}>
        <span className="kmem-per">{index === shown.length - 1 ? 'Aujourd’hui' : 'Historique'}</span>
        <div className="kmem-nm">{owner}</div>
        {index === shown.length - 1 && <div className="kmem-live"><span className="kmem-live-dot" />Live · owner actuel</div>}
      </div>
    </div>)}</div>
  </Section>
}

function Recommendations({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const open = data.recommendations.filter((item) => item.status === 'open' || item.status === 'postponed')
  const act = async (id: string, status: 'completed' | 'dismissed' | 'postponed') => {
    setBusy(id)
    try { await updateRecommendationStatus(data, id, userId, status); await refresh() } finally { setBusy(null) }
  }
  const concentration = data.relationship.concentrationRisk
  const coverage = data.relationship.decisionMakerCoverage
  return <Section id="sec-reco" title="Recommandations" icon="bolt" className="reco-white">
    <div className="risk-grid account-risk-grid">
      <div className="risk-box kn-night">
        <div className="risk-ring" style={{ background: `conic-gradient(var(--coral) 0 ${concentration ?? 0}%, rgba(255,255,255,.12) ${concentration ?? 0}% 100%)` }}><span className="risk-ring-v">{concentration === null ? '—' : `${concentration}%`}</span></div>
        <div className="risk-txt"><div className="risk-t">Risque mono-thread</div><div className="risk-d">La part de relation concentrée sur peu d’interlocuteurs fragilise la continuité du compte.</div></div>
      </div>
      <div className="risk-box kn-night">
        <div className="risk-ring" style={{ background: `conic-gradient(var(--violet) 0 ${coverage ?? 0}%, rgba(255,255,255,.12) ${coverage ?? 0}% 100%)` }}><span className="risk-ring-v">{coverage === null ? '—' : `${coverage}%`}</span></div>
        <div className="risk-txt"><div className="risk-t">Acteurs clés cartographiés</div><div className="risk-d">Couverture persistée des décideurs et influenceurs identifiés sur ce compte.</div></div>
      </div>
    </div>
    {!open.length ? <Empty title="Aucune recommandation ouverte">Tohu n’affiche pas de conseil générique sans signal déclencheur persistant.</Empty> :
      <div className="krs-stack account-krs-stack">{open.map((item) => <article className="krs-card krs-action" key={item.id}>
        <div className="krs-band" />
        <div className="krs-main">
          <div className="krs-crow"><span className="krs-ic"><Icon name="bolt" /></span><span className="krs-kind tache">{item.category}</span><span className="krs-at">{item.title}</span><span className="krs-prio">P{item.priority}</span></div>
          <div className="krs-aw">{item.justification}</div>
          {item.recommendedAction && <div className="account-rec-action">{item.recommendedAction}</div>}
          <div className="krs-arow"><span className="krs-asig">↳ {provenanceLabel(item.provenance)}</span><span className="krs-do-inline">
            <button className="krs-b sm yes fait-yes" disabled={busy === item.id} onClick={() => void act(item.id, 'completed')}>✓ Fait</button>
            <button className="krs-b sm no fait-no" disabled={busy === item.id} onClick={() => void act(item.id, 'dismissed')}>× Pas juste</button>
            <button className="krs-b sm" disabled={busy === item.id} onClick={() => void act(item.id, 'postponed')}>Reporter</button>
          </span></div>
          {item.personId && <Link className="account-rec-person" to={`/app/people/${item.personId}`}>Ouvrir {item.personName ?? 'la personne'} →</Link>}
        </div>
      </article>)}</div>}
  </Section>
}

function RelationshipBand({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const open = data.recommendations.filter((item) => item.status === 'open' || item.status === 'postponed')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const current = open[index % Math.max(open.length, 1)]
  const relation = data.relationship
  const phase = relation.phase
  const state = phase === 'declining' ? 'En refroidissement' : phase === 'growing' ? 'En progression' : phase === 'stable' ? 'Relation stable' : 'À qualifier'
  const tone = phase === 'growing' ? 'sage' : phase === 'declining' ? 'amber' : 'violet'
  const delta = relation.phaseDelta
  const lead = [...data.people].sort((a, b) => (b.exchangeShare ?? 0) - (a.exchangeShare ?? 0))[0]
  const complete = async () => {
    if (!current) return
    setBusy(true)
    try {
      await updateRecommendationStatus(data, current.id, userId, 'completed')
      setIndex((value) => value + 1)
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  return <div className={`relband relband-${tone}`}>
    <div className="rb-scan" />
    <div className="rb-left">
      <span className="rb-state"><span className="rb-dot" />{state}</span>
      <span className="rb-trend">NPS {delta === null ? '—' : `${delta > 0 ? '↗ +' : delta < 0 ? '↘ ' : '→ '}${delta}`} / 30 j</span>
      <span className="rb-fresh"><span className="rb-live" />signal {relativeDate(relation.computedAt).toLowerCase()}</span>
    </div>
    <div className="rb-synth">
      <div className="rb-synth-1">{lead ? `Compte porté par ${lead.name.split(' ')[0]} · ${lead.exchangeShare === null ? 'part des échanges à confirmer' : `${lead.exchangeShare}% des échanges`}.` : 'Couverture relationnelle à construire.'}</div>
      <div className="rb-synth-2">{scoreLabel(relation.score)} depuis le dernier calcul · <span className="rb-src">{data.sources[0]?.label ?? 'Moteur Tohu'}</span></div>
    </div>
    <div className="rb-action">
      <div className="rb-act-inner"><span className="rb-nat rb-nat-rel">Relationnel</span><span className="rb-act-t">{current?.title ?? 'Maintenir la couverture du compte'}</span></div>
      <div className="rb-act-btns"><button className="rb-treat" disabled={!current || busy} onClick={() => void complete()}>Fait</button><button className="rb-other" disabled={open.length < 2} onClick={() => setIndex((value) => value + 1)}>Suivante</button></div>
    </div>
  </div>
}

function Memory({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try { await addAccountNote(data, userId, content.trim()); setContent(''); await refresh() } finally { setSaving(false) }
  }
  return <section className={`feed-card relhist ${expanded ? '' : 'collapsed'}`}>
    <div className="feed-head"><span className="feed-ic"><Icon name="clock" /></span><div><div className="feed-ttl">Historique & mémoire relationnelle</div><div className="feed-sub">Ajoute une note à la mémoire, puis relis les jalons datés et sourcés.</div></div></div>
    <div className="relhist-memory">
      <form onSubmit={(event) => void submit(event)}>
        <textarea className="feed-txt" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ajouter un contexte, une décision, un risque…" />
        <div className="feed-actions"><span className="account-memory-note">Mémoire d’équipe · distincte des faits confirmés</span><button className="feed-save" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Ajouter à la mémoire'}</button></div>
      </form>
    </div>
    <div className="rh-synth">
      <div className="rh-spark" aria-label="Historique du score">{data.relationship.history.slice(-16).map((item, index) => <i key={`${item.computedAt}-${index}`} className={item.score >= 70 ? 'hi' : item.score < 50 ? 'lo' : ''} style={{ height: `${Math.max(5, item.score / 2)}px` }} />)}</div>
      <div className="rh-stats"><div className="rh-stat"><div className="v">{formatDate(data.account.relationshipStartedAt)}</div><div className="l">Relation ouverte</div></div><div className="rh-stat"><div className="v">{data.relationship.totalInteractions}</div><div className="l">Échanges</div></div><div className="rh-stat"><div className="v">{data.people.length}</div><div className="l">Interlocuteurs actifs</div></div><div className="rh-stat"><div className="v">{relativeDate(data.relationship.lastInteractionAt)}</div><div className="l">Dernier contact</div></div></div>
    </div>
    <div className="rh-tl">
      {!data.memoryEntries.length ? <Empty title="Mémoire en construction">Aucune note d’équipe n’a encore été ajoutée.</Empty> : data.memoryEntries.map((entry) => <div className="rh-ev detail" data-type="jalon" key={entry.id}><span className="rh-dot" /><div className="rh-ev-b"><div className="rh-ev-h"><span className="rh-mo">{formatDate(entry.createdAt)}</span><span className="rh-tag jalon">{entry.entryType}</span></div><div className="rh-ev-t">{entry.content}</div><div className="rh-ev-src">↳ {entry.authorName} · {entry.visibility}</div></div></div>)}
    </div>
    <button className="rh-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span>{expanded ? 'Réduire l’historique' : 'Déplier l’historique'}</span><span aria-hidden="true">⌄</span></button>
  </section>
}

function Firmographics({ data }: { data: AccountDetailData }) {
  const grouped = new Map<string, typeof data.firmographics>()
  data.firmographics.forEach((fact) => grouped.set(fact.key, [...(grouped.get(fact.key) ?? []), fact]))
  const preferredKeys = ['address', 'executives', 'fundraising_status']
  const preferred = preferredKeys.flatMap((key) => {
    const facts = grouped.get(key)
    return facts ? [[key, facts] as [string, typeof facts]] : []
  })
  const visible = preferred.length
    ? preferred
    : [...grouped].filter(([key]) => !['revenue', 'profit', 'legal_form'].includes(key)).slice(0, 3)
  return <section className="kid">
    <header className="kid-h"><span className="kid-ic"><Icon name="building" /></span><div><div className="kid-ttl">Carte d’identité</div><div className="kid-sub">Firmographie · sourcée</div></div><span className="account-live-badge"><i />Live</span></header>
    {!visible.length ? <Empty title="Firmographie absente">Aucune donnée publique vérifiée n’est disponible.</Empty> :
      <div className="kid-body">{visible.map(([key, facts]) => {
        const fact = facts[0]!
        return <div className="kid-row" key={key}><div className="kid-k">{FACT_LABELS[key] ?? key.replaceAll('_', ' ')}</div><div className="kid-v">{valueLabel(fact.value)}{facts.length > 1 && <span className="account-fact-warning"> · {facts.length} sources à vérifier</span>}</div></div>
      })}</div>}
    <footer className="kid-foot">{data.firmographics[0] ? provenanceLabel(data.firmographics[0].provenance) : `Actualisé le ${formatDate(data.generatedAt)}`}</footer>
  </section>
}

function Signals({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const validate = async (id: string, verdict: 'confirmed' | 'dismissed') => { await saveSignalFeedback(id, userId, verdict); await refresh() }
  return <section className="sig-card">
    <header className="sig-head"><span className="sig-ic"><Icon name="signal" /></span><div><div className="sig-ttl">Signaux récents</div><div className="sig-sub">Veille syndic · en continu</div></div></header>
    {!data.signals.length ? <Empty title="Aucun signal">Aucun signal réel n’est actuellement rattaché à ce compte.</Empty> :
      <div className="sig-body">{data.signals.map((signal, index) => <article className="sig-item" key={signal.id}>
        <span className="sig-emoji" style={{ '--ico': index % 3 === 0 ? 'var(--sage)' : index % 3 === 1 ? 'var(--amber)' : 'var(--teal)' } as CSSProperties}><Icon name={index % 2 === 0 ? 'signal' : 'building'} /></span>
        <div><div className="sig-it-t">{signal.title}</div>{signal.summary && <div className="sig-it-d">{signal.summary}</div>}
          <div className="sig-meta"><span className="sig-conf" style={{ background: signal.validationStatus === 'dismissed' ? 'var(--coral)' : 'var(--sage)' }} /><span className="sig-src">{signal.provenance.sourceLabel}</span><span className="sig-date">{formatDate(signal.provenance.observedAt)}</span></div>
          <div className="sigfb"><button className="sigfb-b ok" aria-pressed={signal.validationStatus === 'confirmed'} onClick={() => void validate(signal.id, 'confirmed')}>✓ Confirmer</button><button className="sigfb-b no" aria-pressed={signal.validationStatus === 'dismissed'} onClick={() => void validate(signal.id, 'dismissed')}>× Infirmer</button></div>
        </div>
      </article>)}</div>}
    <footer className="sig-foot"><Link to={`/app/signals?accountId=${data.account.id}`}>Voir toute la veille →</Link></footer>
  </section>
}

function WatchCard({ data, open }: { data: AccountDetailData; open: () => void }) {
  return <button type="button" onClick={open} className={`kveille rail-veille ${data.account.watchEnabled ? 'watch-on' : ''}`}>
    <span className="kveille-ic">🛰️</span><span className="kveille-tx"><span className="kveille-t">Veille Tohu</span><span className="kveille-s">signaux internes & externes</span></span>
    <span className={`ktog ${data.account.watchEnabled ? 'on' : ''}`}><span className="ktog-lbl">{data.account.watchEnabled ? 'Activée' : 'Désactivée'}</span><span className="ktog-sw" /></span>
  </button>
}

function EnrichAccountButton({ companyId, accountName }: { companyId: string; accountName: string }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await triggerAccountEnrichment(companyId)
      setFeedback(result.scanned > 0
        ? `${result.scanned} contact${result.scanned > 1 ? 's' : ''} analysé${result.scanned > 1 ? 's' : ''} · ${result.enriched} enrichi${result.enriched > 1 ? 's' : ''}.`
        : `Aucun contact tracké à enrichir pour ${accountName}.`)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Enrichissement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return <span className="account-enrich"><button className="kfav-star" onClick={() => void run()} disabled={busy} title="Enrichir maintenant (super admin)" aria-label="Enrichir maintenant"><Icon name="sparkles" /></button>{feedback && <small>{feedback}</small>}</span>
}

function AccountHero({ data, toggleFavorite }: { data: AccountDetailData; toggleFavorite: () => Promise<void> }) {
  const account = data.account
  const relation = data.relationship
  return <section className={`hero-header account-detail-hero ${account.archivedAt ? 'archived' : ''}`}>
    <div className="hero-body">
      <div className="hero-left">
        <div className="hero-av">{account.logoUrl ? <img src={account.logoUrl} alt={`Logo de ${account.name}`} /> : initials(account.name)}</div>
        <div className="account-hero-copy">
          <h1 className="hero-name">{account.name}<button className={`hero-fav ${account.favorite ? 'on' : ''}`} onClick={() => void toggleFavorite()} aria-label={account.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={account.favorite}>
            <svg viewBox="0 0 24 24" fill={account.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" /></svg>
          </button></h1>
          <div className="hero-sub"><span>{account.sector ?? 'Secteur à confirmer'}</span><span className="hero-dot" /><span>{account.location ?? 'Ville à confirmer'}</span>{account.offerScope && <><span className="hero-dot" /><span>{account.offerScope}</span></>}</div>
          <div className="hero-meta"><span className="crel2-chip"><span className="crel2-k">Relation</span><span className="crel2-dot" /><span className="crel2-v">{account.relationshipStatus ?? account.accountType ?? 'À confirmer'}</span><span className="crel2-def">fidéliser</span><span className="crel2-c">▼</span></span></div>
        </div>
      </div>
      <div className="hero-right account-hero-right">
        <div className="hero-score-block"><div className="hero-score-val">{relation.score ?? '—'}</div><div className="hero-score-label">NPS compte · inféré</div><div className={`hero-score-trend ${relation.phaseDelta !== null && relation.phaseDelta < 0 ? 'down' : ''}`}>{relation.phaseDelta === null ? 'variation indisponible' : `${relation.phaseDelta > 0 ? '↗ +' : relation.phaseDelta < 0 ? '↘ ' : '→ '}${relation.phaseDelta} friction financière`}</div></div>
        <span className="hero-divider" />
        <div className="hero-score-block hero-int"><div className="hero-score-val">{data.people.length}</div><div className="hero-score-label">Interlocuteurs actifs</div></div>
        <span className="hero-divider" />
        <div className="account-confidence"><b>{confidenceLevel(relation.confidence) ?? '—'}</b><span>Confiance</span></div>
      </div>
    </div>
    <div className="ctx-grid hdr-conn">
      <div className="hdr-conn-tiles">{data.sources.length ? data.sources.map((source) => <span className={`src-tile ${['connected', 'ready', 'active'].includes(source.status) ? 'on' : ''}`} key={source.provider}><SourceIcon provider={source.provider} label={source.label} /><span className="src-name">{source.label}</span><span className={`src-led ${['connected', 'ready', 'active'].includes(source.status) ? 'on' : 'off'}`} /></span>) : <span className="src-tile"><span className="src-name">Aucune source contributrice confirmée</span><span className="src-led off" /></span>}</div>
      <Link className="ctx-manage" to="/app/connectors">Gérer les connecteurs <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg></Link>
    </div>
  </section>
}

export default function AccountDetailPage({ context }: { context: PageContext }) {
  const { accountId = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<AccountDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const refresh = useCallback(async () => {
    try { setError(null); setData(await getAccountDetail(context.workspaceId, accountId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur inattendue') }
  }, [accountId, context.workspaceId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void verifySuperAdmin().then(setIsSuperAdmin).catch(() => setIsSuperAdmin(false)) }, [])
  if (error === 'ACCOUNT_NOT_FOUND') return <div className="ra-state"><h1>Compte introuvable</h1><p>Ce compte n’existe pas ou n’est pas accessible dans ton workspace.</p><Link to="/app/accounts">Retour aux comptes</Link></div>
  if (error) return <div className="ra-state error"><h1>Impossible de charger le compte</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!data) return <div className="ra-skeleton" aria-label="Chargement de la fiche compte"><i /><i /><i /></div>
  const account = data.account
  const toggleFavorite = async () => { await setAccountFavorite(data, context.session.user.id, !account.favorite); await refresh() }
  const saveWatch = async (families: string[]) => { await setAccountWatch(data, context.session.user.id, true, families); setWatchOpen(false); await refresh() }
  const archived = Boolean(account.archivedAt)
  const toggleArchived = async () => {
    if (!archived && !window.confirm(`Supprimer ${account.name} de Tohu ? Le compte sera masqué des listes mais l’historique réel (contacts, signaux, échanges) reste conservé — tu pourras le restaurer à tout moment.`)) return
    await setAccountArchived(data, context.session.user.id, !archived)
    window.dispatchEvent(new Event('tohu:workspace-updated'))
    await refresh()
  }
  const toggleLock = async () => {
    await setAccountLock(data, context.session.user.id, !account.lockedByMe)
    await refresh()
  }
  return <div className="pp account-pp">
    <div className="pp-back account-toolbar">
      <Link to="/app/accounts">← Comptes</Link>
      <div className="account-toolbar-actions" aria-label="Actions de la fiche">
        {isSuperAdmin && <EnrichAccountButton companyId={account.id} accountName={account.name} />}
        <Link className="kfav-star" to={`/app/ask?accountId=${account.id}`} title="Demander à Tohu" aria-label="Demander à Tohu"><Icon name="ask" /></Link>
        {account.locked && !account.lockedByMe
          ? <button className="kfav-star" disabled title="Verrouillé par un autre collaborateur" aria-label="Verrouillé par un autre collaborateur"><Icon name="lock" /></button>
          : <button className="kfav-star" onClick={() => void toggleLock()} aria-pressed={account.lockedByMe} title={account.lockedByMe ? 'Lever le verrou' : 'Verrouiller ce compte'} aria-label={account.lockedByMe ? 'Lever le verrou' : 'Verrouiller ce compte'}><Icon name="lock" /></button>}
        <button className="kfav-star" onClick={() => void toggleArchived()} title={archived ? 'Restaurer ce compte' : 'Supprimer ce compte'} aria-label={archived ? 'Restaurer ce compte' : 'Supprimer ce compte'} style={{ color: archived ? 'var(--sage)' : 'var(--coral)' }}><Icon name={archived ? 'restore' : 'trash'} /></button>
      </div>
    </div>
    <div className="page">
      <main className="col-main">
        <AccountHero data={data} toggleFavorite={toggleFavorite} />
        {data.degradedReasons.length > 0 && <div className="ra-degraded"><strong>Données partielles</strong><span>{data.degradedReasons.join(' · ')}</span></div>}
        <div className="kctrl account-kctrl">
          <button className="acct-block" onClick={() => document.getElementById('account-people')?.scrollIntoView({ behavior: 'smooth' })}>
            <span className="acct-mono acct-num">{data.people.length}</span><span className="acct-info"><span className="acct-eyebrow">Contacts sur le compte</span><span className="acct-name">{data.people.length} interlocuteur{data.people.length > 1 ? 's' : ''} actif{data.people.length > 1 ? 's' : ''}</span></span><span className="acct-btn">Voir l’organigramme →</span>
          </button>
          <div className="kowner">
            <span className="kowner-av">{initials(account.primaryOwnerName ?? 'À confirmer')}</span><span className="kowner-b"><span className="kowner-l">Owner de la fiche</span><span className="kowner-n">{account.primaryOwnerName ?? 'À confirmer'}</span><span className="kowner-btn">Changer l’owner</span></span>
            <span className="kvis"><span className="kvis-badge org"><span className="kvi"><Icon name="share" /></span>Organisation<span className="chev">⌄</span></span></span>
          </div>
        </div>
        <RelationshipBand data={data} userId={context.session.user.id} refresh={refresh} />
        <Health data={data} />
        <Recommendations data={data} userId={context.session.user.id} refresh={refresh} />
        <PeopleMap people={data.people} navigate={navigate} />
        <TeamMemory data={data} />
        <Memory data={data} userId={context.session.user.id} refresh={refresh} />
        <div className="pp-footnote">Tohu · {account.name} — chaque bloc est alimenté par des données persistées et sourcées. Les informations non vérifiées sont marquées « à confirmer ».</div>
      </main>
      <aside className="rail account-rail">
        <WatchCard data={data} open={() => setWatchOpen(true)} />
        <Firmographics data={data} />
        <Signals data={data} userId={context.session.user.id} refresh={refresh} />
      </aside>
    </div>
    {watchOpen && <WatchDialog selected={account.watchFamilies} onClose={() => setWatchOpen(false)} onSave={(families) => void saveWatch(families)} />}
  </div>
}

function WatchDialog({ selected, onClose, onSave }: { selected: string[]; onClose: () => void; onSave: (families: string[]) => void }) {
  const [families, setFamilies] = useState(selected)
  return <div className="ra-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ra-dialog" role="dialog" aria-modal="true" aria-labelledby="watch-title"><header><h2 id="watch-title">Configurer la veille Tohu</h2><button onClick={onClose} aria-label="Fermer">×</button></header>
      <p>Sélectionne uniquement les familles utiles à ce compte.</p><div className="ra-watch-list">{WATCH_FAMILIES.map((family) => <label key={family}><input type="checkbox" checked={families.includes(family)} onChange={(event) => setFamilies(event.target.checked ? [...families, family] : families.filter((item) => item !== family))} />{family}</label>)}</div>
      <footer><button onClick={onClose}>Annuler</button><button onClick={() => onSave(families)}>Activer la veille</button></footer>
    </section>
  </div>
}
