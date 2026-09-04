import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { DataSourceReference } from './types'

/** Icônes V48 partagées entre les vues Profil/Relation/Live (person) — un seul jeu
 *  de traits pour toute la fiche personne, évite la divergence visuelle entre fichiers. */
export function V48Icon({ name }: { name: 'calendar' | 'profile' | 'pulse' | 'commitment' | 'career' | 'signal' | 'sparkle' | 'share' | 'sliders' }) {
  const paths: Record<typeof name, ReactNode> = {
    calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
    profile: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /><circle cx="12" cy="12" r="2.5" /></>,
    pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
    commitment: <><path d="M4.5 5.5h5a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H4.5Z" /><path d="M19.5 5.5h-5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h5.5Z" /></>,
    career: <><circle cx="6.5" cy="6" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="M6.5 8.5v5a4.5 4.5 0 0 0 4.5 4.5h4" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></>,
    share: <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" /><path d="M8.2 10.9l7-3.6M8.2 13.1l7 3.6" /></>,
    sliders: <><path d="M4.4 7.4h15.2M4.4 12h15.2M4.4 16.6h15.2" /><circle cx="9" cy="7.4" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7.4" cy="16.6" r="2" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function SectionTitle({ icon, title, meta }: { icon: Parameters<typeof V48Icon>[0]['name']; title: string; meta?: ReactNode }) {
  return <header className="v48-section-title">
    <span><V48Icon name={icon} /></span>
    <h2>{title}</h2>
    {meta && <div>{meta}</div>}
  </header>
}

export function formatDate(value: string | null, fallback = 'À confirmer'): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : fallback
}

export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return monthKey
  return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][month - 1]} ${String(year).slice(2)}`
}

export function relativeDate(value: string | null): string {
  if (!value) return 'Aucun contact'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? 'Aujourd’hui' : days < 31 ? `Il y a ${days} j` : formatDate(value)
}

export function seniorityLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const months = Math.floor((Date.now() - new Date(value).getTime()) / (30.44 * 86_400_000))
  if (months < 1) return '< 1 mois'
  if (months < 24) return `~${months} mois`
  return `~${Math.floor(months / 12)} ans`
}

export function scoreTone(score: number | null): string {
  if (score === null) return 'var(--t3)'
  if (score >= 70) return 'var(--sage)'
  if (score >= 50) return 'var(--amber)'
  return 'var(--coral)'
}

/** Confiance qualitative uniquement — aucun pourcentage décoratif (SPEC-04 §12 / SPEC-05 §12). */
export function confidenceLevel(confidence: number | null): 'faible' | 'moyen' | 'élevé' | null {
  if (confidence === null) return null
  return confidence >= 70 ? 'élevé' : confidence >= 40 ? 'moyen' : 'faible'
}

export function phaseLabel(phase: string): string {
  return ({ growing: '↗ en progression', stable: '→ stable', declining: '↘ en retrait', unknown: 'Phase à confirmer' } as Record<string, string>)[phase] ?? phase
}

export function inferenceLabel(level: string | null): string {
  if (!level) return ''
  return ({ fact: 'Fait', observed: 'Observable', strong_inference: 'Inférence forte', weak_inference: 'Inférence faible', inferred: 'Inféré', manual: 'Manuel' } as Record<string, string>)[level] ?? level
}

export function provenanceLabel(item: DataSourceReference | null): string {
  if (!item) return 'Provenance à confirmer'
  const freshness = item.lastVerifiedAt ?? item.observedAt
  const parts = [item.sourceLabel]
  if (freshness) parts.push(formatDate(freshness))
  if (item.confidence !== null) parts.push(`confiance ${confidenceLevel(item.confidence)}`)
  const inference = inferenceLabel(item.inferenceLevel)
  if (inference) parts.push(inference)
  return parts.join(' · ')
}

/** Section repliable au patron .csec de la référence. */
export function Csec({ id, icon, title, meta, children, defaultOpen = true, className = '' }: { id: string; icon: React.ReactNode; title: string; meta?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`csec ${className} ${open ? 'open' : ''}`.trim()} id={id}>
    <button type="button" className="csec-header" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((value) => !value)} style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}>
      <span className="csec-icon" aria-hidden="true">{icon}</span>
      <span className="csec-title">{title}</span>
      <span className="csec-meta">{meta}<span className="csec-chevron" aria-hidden="true">▼</span></span>
    </button>
    <div className="csec-body" id={`${id}-body`} style={open ? { maxHeight: 'none' } : undefined}>
      {open && <div className="csec-inner">{children}</div>}
    </div>
  </section>
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="pp-empty"><strong>{title}</strong><p>{children}</p></div>
}

export function Prov({ items }: { items: string[] }) {
  return <div className="prov">{items.map((item, index) => <span key={index}>
    {index > 0 && <span className="prov-sep">·</span>}
    <span className={`prov-src ${/inféré|inférence/i.test(item) ? 'inf' : ''}`}>{item}</span>
  </span>)}</div>
}

type ToastContextValue = (message: string, tone?: 'ok' | 'error') => void
const ToastContext = createContext<ToastContextValue>(() => undefined)

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: 'ok' | 'error' }>>([])
  const push = useCallback<ToastContextValue>((message, tone = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600)
  }, [])
  return <ToastContext.Provider value={push}>
    {children}
    <div className="pp-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`pp-toast ${toast.tone}`}>{toast.message}</div>)}
    </div>
  </ToastContext.Provider>
}

export function useBusy(): [string | null, (key: string, action: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try {
      await action()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Action impossible', 'error')
    } finally {
      setBusy(null)
    }
  }, [toast])
  return [busy, run]
}
