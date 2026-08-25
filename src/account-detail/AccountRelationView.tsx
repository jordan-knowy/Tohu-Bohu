import { useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/auth'
import { addAccountNote, updateRecommendationStatus } from './service'
import type { AccountDetailData, AccountPerson } from './types'

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTH_MS = 2_629_746_000

function dateLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }).format(d) : 'À confirmer'
}
function relativeLabel(value: string | null): string {
  if (!value) return 'jamais'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return 'à confirmer'
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  return days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} j`
}
function tenureLabel(value: string | null): string {
  if (!value) return '—'
  const start = new Date(value)
  if (!Number.isFinite(start.getTime())) return '—'
  const months = Math.max(0, Math.floor((Date.now() - start.getTime()) / MONTH_MS))
  if (months < 12) return `${months} mois`
  return `~${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(months / 12)} ans`
}
/** Bande NPS : promoteur ≥70 (vert), passif 50–69 (ambre), détracteur <50 (corail). */
function band(score: number): string {
  return score >= 70 ? 'var(--sage)' : score >= 50 ? 'var(--amber)' : 'var(--coral)'
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="acr-empty"><span>◇</span><p>{children}</p></div>
}

const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function monthLabel(key: number): string { const y = Math.floor(key / 12); const m = ((key % 12) + 12) % 12; return `${MONTH_NAMES[m]} ${String(y).slice(2)}` }
type MonthBar = { label: string; score: number | null }

/** Une barre par MOIS sur la fenêtre choisie (6/12/36) — score = moyenne des
 *  snapshots du mois, `null` = mois sans donnée (barre grise). C'est ce qui rend
 *  le toggle 6/12/36 réellement fonctionnel et différent d'un compte à l'autre. */
function buildMonthlyBars(history: Array<{ score: number; computedAt: string }>, windowMonths: number): MonthBar[] {
  const byMonth = new Map<number, { sum: number; n: number }>()
  for (const h of history) {
    const d = new Date(h.computedAt)
    if (!Number.isFinite(d.getTime())) continue
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth()
    const e = byMonth.get(key) ?? { sum: 0, n: 0 }
    e.sum += h.score; e.n++; byMonth.set(key, e)
  }
  const now = new Date()
  const lastKey = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const bars: MonthBar[] = []
  for (let i = windowMonths - 1; i >= 0; i--) {
    const e = byMonth.get(lastKey - i)
    bars.push({ label: monthLabel(lastKey - i), score: e ? Math.round(e.sum / e.n) : null })
  }
  return bars
}

type Tip = { left: number; top: number; above: boolean; content: ReactNode }
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (e: SyntheticEvent, content: ReactNode) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const above = r.top > 160
    const left = Math.min(Math.max(8, r.left + r.width / 2 - 100), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 208)
    setTip({ left, top: above ? r.top - 8 : r.bottom + 8, above, content })
  }
  const hide = () => setTip(null)
  const node = tip ? createPortal(<div className="v48-tipx" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : 'none' }}>{tip.content}</div>, document.body) : null
  return { show, hide, node }
}

// ── Pilule Connecteurs (dans la barre d'onglets) ────────────────────────────
function providerColor(provider: string): string {
  const p = provider.toLowerCase()
  if (/google|gmail/.test(p)) return '#DB4437'
  if (/outlook|microsoft|azure/.test(p)) return '#0078D4'
  if (/read/.test(p)) return '#6E50C8'
  if (/linkedin/.test(p)) return '#0A66C2'
  if (/teams/.test(p)) return '#4B53BC'
  if (/hubspot/.test(p)) return '#FF7A59'
  return '#6E50C8'
}
function providerInitial(label: string): string {
  return initials(label).slice(0, 2) || '?'
}
const isConnected = (s: AccountDetailData['sources'][number]) => s.status === 'connected' || (s.interactionCount ?? 0) > 0

export function AccountConnectorsPill({ sources }: { sources: AccountDetailData['sources'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [panel, setPanel] = useState<{ top: number; right: number } | null>(null)
  const show = () => {
    clearTimeout(timer.current)
    const r = ref.current?.getBoundingClientRect()
    if (r) setPanel({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right) })
  }
  const hide = () => { timer.current = setTimeout(() => setPanel(null), 130) }
  if (!sources.length) return null
  const connected = sources.filter(isConnected)
  return (
    <div className="acnx" ref={ref} tabIndex={0} aria-label="Connecteurs du compte" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <span className="acnx-st" aria-hidden="true">
        {sources.slice(0, 4).map((s, i) => (
          <i key={i} className={isConnected(s) ? '' : 'off'} style={{ background: providerColor(s.provider) }}>{providerInitial(s.label)}</i>
        ))}
      </span>
      <span className="acnx-v">{connected.length} connecté{connected.length > 1 ? 's' : ''}</span>
      {panel && createPortal(
        <div className="acnx-p" style={{ top: panel.top, right: panel.right }} role="menu" onMouseEnter={show} onMouseLeave={hide}>
          {sources.map((s, i) => (
            <div className="acnx-r" key={i} role="menuitem">
              <i className={isConnected(s) ? '' : 'off'} style={{ background: providerColor(s.provider) }}>{providerInitial(s.label)}</i>
              <div className="acnx-n">
                <b>{s.label}</b>
                {s.interactionCount != null && <span className="acnx-vol">{s.interactionCount} échange{s.interactionCount > 1 ? 's' : ''}</span>}
                <span className="acnx-note">{isConnected(s) ? 'Connecté' : (s.error || 'Non connecté')}{s.lastSyncedAt ? ` · synchro ${relativeLabel(s.lastSyncedAt)}` : ''}</span>
              </div>
            </div>
          ))}
        </div>, document.body)}
    </div>
  )
}

// ── Santé du compte ─────────────────────────────────────────────────────────
const PulseIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.4 12h4.2l2-5.2 3.4 10.4 2.2-5.2h5.4" /></svg>
const PeopleIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8.5" cy="8" r="3" /><path d="M3 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.4a3 3 0 0 1 0 5.2" /><path d="M17.6 19a5.6 5.6 0 0 0-2.3-4.5" /></svg>
const StrategyIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10.6" cy="13.4" r="7.4" /><circle cx="10.6" cy="13.4" r="3" /><path d="M13.2 10.8 20 4" /><path d="M16.4 4H20v3.6" /></svg>
const HistoryIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.1 1.9" /></svg>

function HealthSection({ data, currentUserName, onOpenModal }: { data: AccountDetailData; currentUserName: string; onOpenModal: () => void }) {
  const [segMonths, setSegMonths] = useState(12)
  const rel = data.relationship

  const tip = useTip()
  const bars = useMemo(() => buildMonthlyBars(rel.history, segMonths), [rel.history, segMonths])
  const real = bars.filter((b) => b.score !== null)
  let lastRealIdx = -1
  for (let i = 0; i < bars.length; i++) if (bars[i]!.score !== null) lastRealIdx = i
  const windowDelta = real.length >= 2 ? (real[real.length - 1]!.score! - real[0]!.score!) : null
  const barTip = (b: MonthBar) => <><p className="v48-tipx-t">Score du compte</p><p className="v48-tipx-d">{b.label} · {b.score === null ? <b>pas encore de données</b> : <><b>{b.score}</b>/100</>}</p></>

  // Répartition par interlocuteur : contacts scorés, triés desc.
  const contributors = useMemo(() => [...data.people].filter((p) => p.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8), [data.people])

  // Couverture interne : membres internes (owners des contacts) + leur score
  // relationnel agrégé avec CE compte (moyenne de leurs contacts scorés ici).
  const coverage = useMemo(() => {
    const byOwner = new Map<string, number[]>()
    for (const p of data.people) {
      if (!p.ownerName || p.score === null) continue
      byOwner.set(p.ownerName, [...(byOwner.get(p.ownerName) ?? []), p.score])
    }
    const me = (currentUserName || '').trim().toLowerCase()
    return [...byOwner.entries()]
      .map(([name, scores]) => ({ name, score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), isMe: !!me && name.trim().toLowerCase() === me }))
      .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.score - a.score)
  }, [data.people, currentUserName])

  return (
    <section className="sec">
      <div className="sec-h">{PulseIcon}<p className="sec-t">Santé du compte</p>
        <button className="det" onClick={onOpenModal} aria-label="Comment le score est calculé">i</button>
      </div>
      <div className="sec-b">
        <div className="cpt-top">
          <p className="big">{rel.score ?? '—'}</p>
          <p className="cpt-per">
            <span>{segMonths} mois</span>
            {windowDelta !== null && <span>{windowDelta >= 0 ? `↗ +${windowDelta}` : `↘ ${windowDelta}`} pts</span>}
          </p>
          <div className="seg">
            {[6, 12, 36].map((m) => <span key={m} className={segMonths === m ? 'on' : ''} onClick={() => setSegMonths(m)}>{m} M</span>)}
          </div>
        </div>

        {real.length >= 1 ? <>
          <div className="chart">{bars.map((b, i) => b.score === null
            ? <i key={i} className="empty" style={{ height: '7%', background: '#E3DEF2' }} title={`${b.label} · pas encore de données`} />
            : <i key={i} tabIndex={0}
                style={{ height: `${Math.max(5, b.score)}%`, background: i === lastRealIdx ? 'linear-gradient(180deg,#C97A20,#DFA153)' : 'linear-gradient(180deg,#3FAEBE,#2896A8)' }}
                onMouseEnter={(e) => tip.show(e, barTip(b))} onFocus={(e) => tip.show(e, barTip(b))} onMouseLeave={tip.hide} onBlur={tip.hide} />)}</div>
          <div className="ch-x"><span>{bars[0]!.label}</span><span>{bars[bars.length - 1]!.label}</span></div>
        </> : <Empty>L’évolution du score apparaîtra après plusieurs calculs persistés.</Empty>}
        {tip.node}

        <div className="cpt-mini">
          <span><b>{tenureLabel(data.account.relationshipStartedAt)}</b> d’ancienneté</span>
          <span><b>{rel.totalInteractions || '—'}</b> échanges</span>
          <span><b>{data.people.length}</b> contacts</span>
        </div>
        {windowDelta !== null && <span className={`evo ${windowDelta < 0 ? 'down' : 'up'}`}>{windowDelta < 0 ? '↘' : '↗'} {windowDelta >= 0 ? `+${windowDelta}` : windowDelta} pts <em>sur {segMonths} mois</em></span>}

        <p className="xl">Répartition par interlocuteur</p>
        {contributors.length ? <>
          {contributors.map((p) => <div className="cnb" key={p.id}>
            <span className="cnb-n">{p.name}</span>
            <span className="cnb-t"><i className="cnb-z" style={{ left: '50%' }} /><i className="cnb-z" style={{ left: '70%' }} /><i className="cnb-f" style={{ width: `${p.score}%`, background: band(p.score ?? 0) }} /></span>
            <span className="cnb-v" style={{ color: band(p.score ?? 0) }}>{p.score}</span>
          </div>)}
          <p className="cnl"><span><i style={{ background: 'var(--coral)' }} />Détracteur &le;50</span><span><i style={{ background: 'var(--amber)' }} />Passif 50–69</span><span><i style={{ background: 'var(--sage)' }} />Promoteur &ge;70</span></p>
        </> : <Empty>Aucun score individuel mesurable pour ce compte.</Empty>}

        <div className="lvs">
          <p className="lvs-h"><i className="lvs-i" />Dernière synchronisation : <b>{relativeLabel(rel.computedAt)}</b></p>
          <span className="lvs-bar" />
        </div>

        <div className="cvi">
          <div className="cvi-h">{PeopleIcon}<p className="cvi-t">Couverture interne</p><span className="cvi-n">{coverage.length} membre{coverage.length > 1 ? 's' : ''}</span></div>
          {coverage.length ? coverage.map((m) => <div className={`cvi-row ${m.isMe ? 'me' : ''}`} key={m.name}>
            <span className="cvi-av">{m.isMe ? 'MOI' : initials(m.name)}</span>
            <span className="cvi-nm">{m.isMe ? 'Vous' : m.name}</span>
            <span className="cvi-sc" style={{ color: band(m.score) }}>{m.score}</span>
          </div>) : <div className="cvi-row"><span className="cvi-nm" style={{ color: 'var(--pale)', fontWeight: 400 }}>Aucun membre interne rattaché aux contacts de ce compte.</span></div>}
        </div>
      </div>
    </section>
  )
}

// ── Stratégie de compte (carrousel) ─────────────────────────────────────────
const PAGE = 5
type Rec = AccountDetailData['recommendations'][number]

// Une carte action = mouvement/engagement. Le « i » déplie la preuve (canal ·
// date · pourquoi), comme sur la fiche personne (readme : preuves sur les deux fiches).
function StrategyCard({ rec, busy, act }: { rec: Rec; busy: boolean; act: (status: 'completed' | 'dismissed') => void }) {
  const [proof, setProof] = useState(false)
  return (
    <article className="mv">
      <span className="mv-s">{rec.category}</span>
      <div className="mv-c">
        <div className="mv-h"><p className="mv-t">{rec.title}</p><span className="mv-p">prio {rec.priority}</span></div>
        <p className="mv-d">{rec.justification}</p>
        {rec.recommendedAction && <p className="mv-d"><b style={{ color: 'var(--ink)' }}>{rec.recommendedAction}</b></p>}
        <p className="mv-src">↳ {rec.provenance.sourceLabel}{rec.personName ? ` · ${rec.personName}` : ''}</p>
        {proof && <div className="mv-proof">
          <div className="mv-proof-meta"><span>{rec.provenance.sourceLabel}</span>{rec.provenance.observedAt && <span>· {dateLabel(rec.provenance.observedAt)}</span>}{rec.provenance.confidence !== null && <span>· confiance {rec.provenance.confidence}%</span>}</div>
          <p className="mv-proof-q"><span className="mv-proof-l">Pourquoi</span>{rec.justification || rec.recommendedAction || 'Déduit de la dynamique observée sur le compte.'}</p>
        </div>}
      </div>
      <div className="mv-b">
        <button className="mv-i" aria-expanded={proof} title="D’où vient cette action ?" onClick={() => setProof((v) => !v)}>i</button>
        <button className="mv-ok" disabled={busy} title="Fait" onClick={() => act('completed')}>✓</button>
        <button className="mv-no" disabled={busy} title="Écarter" onClick={() => act('dismissed')}>×</button>
      </div>
    </article>
  )
}

function StrategySection({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const open = useMemo(() => data.recommendations.filter((r) => r.status === 'open' || r.status === 'postponed').sort((a, b) => b.priority - a.priority), [data.recommendations])
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const pages = Math.max(1, Math.ceil(open.length / PAGE))
  const current = open.slice(page * PAGE, page * PAGE + PAGE)
  const act = (id: string) => async (status: 'completed' | 'dismissed') => {
    setBusy(id)
    try { await updateRecommendationStatus(data, id, userId, status); await refresh() } finally { setBusy(null) }
  }
  return (
    <section className="sec">
      <div className="sec-h">{StrategyIcon}<p className="sec-t">Stratégie de compte</p><span className="cnt"><b>{open.length}</b> action{open.length > 1 ? 's' : ''}</span></div>
      <div className="sec-b">
        {open.length ? <>
          <div className="mvs">
            {current.map((r) => <StrategyCard key={r.id} rec={r} busy={busy === r.id} act={(status) => void act(r.id)(status)} />)}
          </div>
          {pages > 1 && <div className="mvp">
            <button className="mvp-b" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Précédent</button>
            <span className="mvp-i">{page * PAGE + 1}–{Math.min(open.length, page * PAGE + PAGE)} sur {open.length}</span>
            <button className="mvp-b" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Suivant →</button>
          </div>}
        </> : <Empty>Aucune recommandation stratégique ouverte n’est étayée actuellement.</Empty>}
      </div>
    </section>
  )
}

// ── Historique & mémoire ─────────────────────────────────────────────────────
type Moment = { id: string; date: string | null; impact: 'renf' | 'frict' | 'jalon' | 'neut'; label: string; title: string; meta: string | null }
const IMPACT_LABEL: Record<Moment['impact'], string> = { renf: 'Renforce', frict: 'Friction', jalon: 'Jalon', neut: 'Neutre' }

function momentsFrom(data: AccountDetailData): Moment[] {
  const fromSignals: Moment[] = data.signals.map((s) => {
    const text = `${s.type} ${s.title} ${s.summary ?? ''}`.toLowerCase()
    const impact: Moment['impact'] = /risqu|churn|friction|retard|silence|perte|départ|insatisf/.test(text) ? 'frict'
      : /gagn|sign|renouv|expansion|avancé|accord|livr/.test(text) ? 'renf' : 'jalon'
    return { id: `sig-${s.id}`, date: s.provenance.observedAt, impact, label: s.title, title: s.title, meta: s.summary ?? s.impact ?? s.provenance.sourceLabel }
  })
  const fromMemory: Moment[] = data.memoryEntries.map((m) => ({ id: `mem-${m.id}`, date: m.createdAt, impact: 'neut', label: m.content, title: m.content, meta: `${m.entryType} · ${m.authorName}` }))
  return [...fromSignals, ...fromMemory].filter((m) => m.date).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
}

function HistorySection({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const owners = useMemo(() => {
    const list = [...new Set(data.people.map((p) => p.ownerName).filter((x): x is string => !!x))]
    if (data.account.primaryOwnerName && !list.includes(data.account.primaryOwnerName)) list.push(data.account.primaryOwnerName)
    return list
  }, [data.people, data.account.primaryOwnerName])

  const moments = useMemo(() => momentsFrom(data), [data])
  const shown = expanded ? moments : moments.slice(0, 5)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try { await addAccountNote(data, userId, content.trim()); setContent(''); await refresh() } finally { setSaving(false) }
  }

  return (
    <section className="sec">
      <div className="sec-h"><span className="hm-i">{HistoryIcon}</span><p className="sec-t">Historique &amp; mémoire du compte</p><span className="memc">{data.memoryEntries.length} entrée{data.memoryEntries.length > 1 ? 's' : ''} en mémoire</span></div>
      <div className="sec-b">
        {owners.length > 0 && <div className="rl">
          <p className="rl-l">Qui a porté la relation</p>
          <div className="rl-t">
            {owners.map((o, i) => <div className="rl-s" key={o} style={{ display: 'contents' }}>
              <div className={`rl-s ${i === owners.length - 1 ? 'cur' : ''}`}><span className="rl-a">{initials(o)}</span><div className="rl-c"><p className="rl-n">{o}</p></div></div>
              {i < owners.length - 1 && <span className="rl-r" />}
            </div>)}
          </div>
          <span className="rl-k">{owners.length > 1 ? `${owners.length - 1} passation${owners.length - 1 > 1 ? 's' : ''}` : 'Owner unique'}</span>
        </div>}

        <div className="hm-s">
          <div className="hm-k"><p className="hm-kv">{dateLabel(data.account.relationshipStartedAt)}</p><p className="hm-kl">Premier échange</p></div>
          <div className="hm-k"><p className="hm-kv">{data.relationship.totalInteractions || '—'}</p><p className="hm-kl">Échanges au total</p></div>
          <div className="hm-k"><p className="hm-kv">{data.people.length}</p><p className="hm-kl">Interlocuteurs actifs</p></div>
        </div>

        <p className="km-l">L’histoire du compte {moments.length > 0 && <span className="km-n">{moments.length}</span>}</p>
        {shown.length ? <div className="tl2">
          {shown.map((m) => <div className={`tlr ${m.impact === 'frict' ? 'frict' : ''}`} key={m.id}>
            <span className="tlr-d">{dateLabel(m.date)}</span>
            <span className="tlr-n"><i className={m.impact} /></span>
            <div><p className="tlr-t">{m.title}</p>{m.meta && <p className="tlr-m">{m.meta}</p>}</div>
            <span className={`eff ${m.impact}`}>{IMPACT_LABEL[m.impact]}</span>
          </div>)}
          {moments.length > 5 && <button className="mvp-b" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Réduire' : `En savoir + (${moments.length - 5})`}</button>}
        </div> : <Empty>L’histoire du compte se construira à partir des signaux, notes et interactions persistés.</Empty>}

        <form onSubmit={(e) => void submit(e)}>
          <textarea className="hm-x" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ex : Christèle part en congés début mai, passer par Tanguy sur les OS." />
          <div className="hm-r"><button className="hm-p" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        </form>
      </div>
    </section>
  )
}

// ── Modale explicative du score ─────────────────────────────────────────────
function ScoreModal({ data, onClose }: { data: AccountDetailData; onClose: () => void }) {
  const rel = data.relationship
  const rows: Array<{ label: string; value: number | null; desc: string }> = [
    { label: 'Couverture contacts', value: rel.contactCoverage, desc: 'Part des interlocuteurs clés réellement couverts par un échange suivi.' },
    { label: 'Couverture décideur', value: rel.decisionMakerCoverage, desc: 'Présence d’un lien avec le(s) décideur(s) du compte.' },
    { label: 'Répartition (anti-concentration)', value: rel.concentrationRisk === null ? null : Math.max(0, 100 - rel.concentrationRisk), desc: 'Un compte porté par un seul contact est plus fragile.' },
  ]
  return createPortal(
    <div className="acr-mask" onClick={onClose}>
      <div className="acr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mo-h"><p className="mo-t">Comment le score du compte est calculé</p><button className="mo-x" onClick={onClose} aria-label="Fermer">×</button></div>
        <div className="mo-b">
          <p className="mo-i">Le compte n’est <b>pas une simple somme de dyades</b> : certains faits n’appartiennent à personne — couverture décideur, concentration sur un relais, redondance interne. Score global : <b>{rel.score ?? '—'}</b>{rel.confidence !== null ? ` · fiabilité ${rel.confidence}%` : ''}.</p>
          {rows.map((r) => <div className="mo-s" key={r.label}>
            <div className="mo-hd"><p className="mo-l">{r.label}</p><p className="mo-v">{r.value ?? '—'}<small>/100</small></p></div>
            <span className="mo-g"><i style={{ width: `${r.value ?? 0}%` }} /></span>
            <p className="mo-d">{r.desc}</p>
          </div>)}
          <p className="mo-f">Le revenu n’entre jamais dans le calcul — c’est la variable à prédire. Dérivé de {rel.totalInteractions} échange{rel.totalInteractions > 1 ? 's' : ''} · {data.sources.map((s) => s.label).join(' + ') || 'sources à confirmer'} · calculé {dateLabel(data.generatedAt)}.</p>
        </div>
      </div>
    </div>, document.body)
}

// ── Vue Relation ─────────────────────────────────────────────────────────────
export function AccountRelationView({ data, userId, currentUserName, refresh, navigate: _navigate }: {
  data: AccountDetailData
  userId: string
  currentUserName: string
  refresh: () => Promise<void>
  navigate: (path: string) => void
}) {
  const [modal, setModal] = useState(false)
  return (
    <div className="acr">
      <div className="cols">
        <HealthSection data={data} currentUserName={currentUserName} onOpenModal={() => setModal(true)} />
        <StrategySection data={data} userId={userId} refresh={refresh} />
      </div>
      <HistorySection data={data} userId={userId} refresh={refresh} />
      {modal && <ScoreModal data={data} onClose={() => setModal(false)} />}
    </div>
  )
}

export type { AccountPerson as _AccountPerson }
