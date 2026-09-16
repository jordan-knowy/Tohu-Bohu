import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { saveSignalFeedback } from '../services/data'
import type { AccountDetailData, AccountSignal } from './types'

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

function Icon({ name }: { name: 'pulse' | 'strategy' | 'history' | 'sparkle' | 'people' | 'signal' | 'radar' }) {
  const paths: Record<typeof name, ReactNode> = {
    pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
    strategy: <><path d="M5 19 19 5M8 5h11v11" /><circle cx="7" cy="17" r="3" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></>,
    people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3.5 20c.6-4 2.5-6 5.5-6s5 2 5.5 6M14 15c3.4-.4 5.5 1.2 6 4" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
    radar: <><circle cx="12" cy="12" r="9" /><path d="M12 12 17 7M12 3v3M12 18v3M3 12h3M18 12h3" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

// Catégorie d'un signal → tag + tonalité, sur les 5 catégories métier (voir la
// même logique côté fiche Personne, sections2.tsx::signalCategory — dupliquée
// ici car AccountSignal porte un champ `impact` que PersonSignal n'a pas).
//  - Externe   : veille sur le statut/poste déclaré (mouvement factuel).
//  - Vigilance : risque relationnel structurel (concentration, bus factor, tension qui monte).
//  - Friction  : un point précis resté sans réponse/non clos (relance sans retour, solde non reversé).
//  - Actif     : ce que le compte publie ou met en place récemment.
//  - Contexte  : le reste (mutuel, secteur commun…).
type SignalTag = 'Externe' | 'Vigilance' | 'Friction' | 'Actif' | 'Contexte'
type SignalTone = 'external' | 'vigilance' | 'friction' | 'active' | 'context'
const SIGNAL_TONE_COLOR: Record<SignalTone, string> = { external: '#6E50C8', vigilance: '#C97A20', friction: '#D94F63', active: '#2EA86A', context: '#2896A8' }
function signalCategory(signal: AccountSignal): { tag: SignalTag; tone: SignalTone } {
  const type = signal.type.toLowerCase()
  const text = `${signal.title} ${signal.summary ?? ''} ${signal.impact ?? ''}`.toLowerCase()
  if (['deadline', 'silence'].includes(type) || /sans retour|sans r[ée]ponse|relanc[ée]|non revers[ée]|non r[ée]gl[ée]|impay|litige|point de friction/.test(text)) {
    return { tag: 'Friction', tone: 'friction' }
  }
  if (['churn'].includes(type) || /tension|risque|concentration|bus factor/.test(text)) {
    return { tag: 'Vigilance', tone: 'vigilance' }
  }
  if (['job_change', 'mobility', 'governance'].includes(type) || /\bposte\b|\bstatut\b|nomination|dirigeant/.test(text)) {
    return { tag: 'Externe', tone: 'external' }
  }
  if (['recent_activity', 'news'].includes(type) || /publication|prise de parole|lancement|partenariat|événement|recrutement|levée|financement|reconnaissance|expansion|signature/.test(text)) {
    return { tag: 'Actif', tone: 'active' }
  }
  return { tag: 'Contexte', tone: 'context' }
}

// Action contextuelle : n'apparaît que si une vraie URL source existe. Aucun
// autre CTA (ex. « débloquer ») tant qu'aucune action réelle n'existe côté Tohu.
function signalAction(signal: AccountSignal): { label: string; url: string } | null {
  const url = signal.provenance.sourceUrl
  if (!url) return null
  const label = signal.provenance.sourceLabel ?? ''
  if (/pappers|rcs/i.test(label)) return { label: 'Ouvrir la fiche Pappers →', url }
  if (/outlook|gmail|mail|email/i.test(label)) return { label: 'Ouvrir le mail →', url }
  return { label: 'Ouvrir la source →', url }
}

function toneStyle(tone: SignalTone): CSSProperties {
  return { '--sig-tone': SIGNAL_TONE_COLOR[tone] } as CSSProperties
}

// « Le signal qui compte » : company_signals ne porte aucune colonne de
// priorité — on retient donc la catégorie la plus sensible (Friction >
// Vigilance > Externe > Actif > Contexte), puis le plus récent en cas
// d'égalité. Un tri de présentation sur des données réelles, jamais un score inventé.
const SIGNAL_TONE_RANK: Record<SignalTone, number> = { friction: 0, vigilance: 1, external: 2, active: 3, context: 4 }
function pickPrioritySignal(signals: AccountSignal[]): AccountSignal | null {
  if (!signals.length) return null
  return [...signals].sort((a, b) => {
    const rank = SIGNAL_TONE_RANK[signalCategory(a).tone] - SIGNAL_TONE_RANK[signalCategory(b).tone]
    if (rank !== 0) return rank
    const at = a.provenance.observedAt ? new Date(a.provenance.observedAt).getTime() : 0
    const bt = b.provenance.observedAt ? new Date(b.provenance.observedAt).getTime() : 0
    return bt - at
  })[0] ?? null
}

type ValidateFn = (id: string, verdict: 'confirmed' | 'dismissed') => void

function SignalValidation({ signal, busy, onValidate }: { signal: AccountSignal; busy: string | null; onValidate: ValidateFn }) {
  return <span className="v48-sig-acts">
    <button className={signal.validationStatus === 'confirmed' ? 'on' : ''} disabled={busy === signal.id} onClick={() => onValidate(signal.id, 'confirmed')} title="Confirmer">✓</button>
    <button className={signal.validationStatus === 'dismissed' ? 'on no' : 'no'} disabled={busy === signal.id} onClick={() => onValidate(signal.id, 'dismissed')} title="Infirmer">×</button>
  </span>
}

// « Le signal qui compte » — la seule grosse carte du module, mise en avant
// avec la tonalité de sa catégorie (§5).
function PrioritySignal({ signal, cat, busy, onValidate }: { signal: AccountSignal; cat: { tag: SignalTag; tone: SignalTone }; busy: string | null; onValidate: ValidateFn }) {
  const action = signalAction(signal)
  return <article className="v48-radar-top" style={toneStyle(cat.tone)}>
    <span className="v48-radar-top-ic"><Icon name="signal" /></span>
    <div className="v48-radar-top-body">
      <p className="v48-radar-top-kicker">Le signal qui compte · {cat.tag}</p>
      <h3>{signal.title}</h3>
      <p>{signal.summary || signal.impact || 'Détail en cours de consolidation.'}</p>
      <div className="v48-radar-top-foot">
        {signal.provenance.sourceLabel && <span className="v48-sig-chan"><i />{signal.provenance.sourceLabel}</span>}
        <span>{relativeLabel(signal.provenance.observedAt)}</span>
        <SignalValidation signal={signal} busy={busy} onValidate={onValidate} />
        {action && <a className="v48-radar-top-cta" href={action.url} target="_blank" rel="noreferrer">{action.label}</a>}
      </div>
    </div>
  </article>
}

// Signaux secondaires — liste légère, pas de grosse carte (§6).
function SecondarySignalRow({ signal, cat, busy, onValidate }: { signal: AccountSignal; cat: { tag: SignalTag; tone: SignalTone }; busy: string | null; onValidate: ValidateFn }) {
  const action = signalAction(signal)
  return <article className="v48-radar-row" style={toneStyle(cat.tone)}>
    <span className="v48-radar-row-ic"><Icon name="signal" /></span>
    <div className="v48-radar-row-body">
      <div className="v48-radar-row-head">
        <strong>{signal.title}</strong>
        <span className="v48-sig-cat">{cat.tag}</span>
        <span className="v48-radar-row-when">{relativeLabel(signal.provenance.observedAt)}</span>
      </div>
      <p>{signal.summary || signal.impact || 'Détail en cours de consolidation.'}</p>
      <div className="v48-radar-row-foot">
        {signal.provenance.sourceLabel && <span className="v48-sig-chan"><i />{signal.provenance.sourceLabel}</span>}
        {action && <a className="v48-sig-open" href={action.url} target="_blank" rel="noreferrer">{action.label}</a>}
        <SignalValidation signal={signal} busy={busy} onValidate={onValidate} />
      </div>
    </div>
  </article>
}

// ── Agent de signal externe (§2-§7) ──────────────────────────────────────────
// Un seul module (fond violet nuit) : header + ligne de synchronisation + signal
// prioritaire + liste légère des autres signaux. N'affiche QUE des états réels :
// pas de « prochain balayage » (company_signals ne trace aucun run global), et la
// ligne de sync réutilise le même calcul que la fiche Personne (dernière valeur
// réelle de connectors.last_synced_at) plutôt qu'une donnée inventée.
function SignalRadarModule({ data, userId, refresh, openWatch }: Omit<ViewProps, 'navigate'> & { openWatch: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const account = data.account
  const signals = data.signalsHistory
  const validate: ValidateFn = (id, verdict) => {
    setBusy(id)
    void saveSignalFeedback(id, userId, verdict).then(refresh).finally(() => setBusy(null))
  }
  const categorized = useMemo(() => signals.map((signal) => ({ signal, cat: signalCategory(signal) })), [signals])
  const top = useMemo(() => pickPrioritySignal(signals), [signals])
  const others = categorized.filter(({ signal }) => signal.id !== top?.id)
  const shown = expanded ? others : others.slice(0, 5)
  const rest = others.length - shown.length

  const connectedSources = data.sources.filter((source) => source.status === 'connected')
  const lastSync = connectedSources.map((source) => source.lastSyncedAt).filter((value): value is string => value !== null).sort().pop() ?? null
  const sourcesLabel = connectedSources.map((source) => source.label).join(' · ')

  return <section className="v48-radar">
    <header className="v48-radar-head">
      <div className="v48-radar-head-l">
        <span className="v48-radar-ic"><Icon name="radar" /></span>
        <div>
          <h2>Agent de signal externe</h2>
          <p className="v48-radar-scope">{account.name} · registre · presse · réseaux · domaines · faits datés à valider</p>
        </div>
      </div>
      <div className="v48-radar-head-r">
        <span className="v48-radar-count"><b>{signals.length}</b> capté{signals.length > 1 ? 's' : ''}</span>
        <button type="button" className={`v48-radar-status ${account.watchEnabled ? 'on' : ''}`} onClick={openWatch} title="Gérer la veille">
          <i />{account.watchEnabled ? 'En veille' : 'Veille coupée'}
        </button>
      </div>
    </header>
    {account.watchEnabled
      ? <div className={`v48-radar-sync ${lastSync ? '' : 'off'}`}><i />
          {lastSync ? <>Dernière synchronisation <b>{relativeLabel(lastSync)}</b></> : 'En attente de la première synchronisation'}
          {sourcesLabel && <> · {sourcesLabel}</>}
        </div>
      : <div className="v48-radar-sync off"><i />Veille coupée — aucun nouveau signal ne sera collecté.</div>}
    <div className="v48-radar-body">
      {!signals.length
        ? <div className="v48-radar-empty">{!account.watchEnabled
            ? 'La veille externe est désactivée pour ce compte — aucun signal ne sera collecté.'
            : 'Aucun signal de veille externe collecté pour l’instant sur ce compte.'}</div>
        : <>
          {top && <PrioritySignal signal={top} cat={signalCategory(top)} busy={busy} onValidate={validate} />}
          {others.length > 0 && <div className="v48-radar-list">
            {shown.map(({ signal, cat }) => <SecondarySignalRow key={signal.id} signal={signal} cat={cat} busy={busy} onValidate={validate} />)}
          </div>}
          {rest > 0 && <button type="button" className="v48-more" onClick={() => setExpanded(true)}>Voir {rest} signal{rest > 1 ? 'aux' : ''} de plus ▾</button>}
          {expanded && others.length > 5 && <button type="button" className="v48-more" onClick={() => setExpanded(false)}>Réduire ▴</button>}
        </>}
    </div>
  </section>
}

export function V48AccountLiveView(props: ViewProps & { openWatch: () => void }) {
  return <div className="v48-account-live">
    <SignalRadarModule data={props.data} userId={props.userId} refresh={props.refresh} openWatch={props.openWatch} />
  </div>
}

export function V48AccountSourceNote({ data }: { data: AccountDetailData }) {
  return <footer className="v48-source-note">{data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} analysé{data.relationship.totalInteractions > 1 ? 's' : ''} · calculé {dateLabel(data.generatedAt)}{data.account.websiteUrl && <> · <a href={data.account.websiteUrl} target="_blank" rel="noreferrer">{data.account.domain || data.account.name}</a></>}</footer>
}
