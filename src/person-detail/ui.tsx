import { createContext, useCallback, useContext, useState } from 'react'
import type { DataSourceReference } from './types'

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
  if (item.confidence !== null) parts.push(`confiance ${Math.round(item.confidence)}%`)
  const inference = inferenceLabel(item.inferenceLevel)
  if (inference) parts.push(inference)
  return parts.join(' · ')
}

/** Section repliable au patron .csec de la référence. */
export function Csec({ id, icon, title, meta, children, defaultOpen = true }: { id: string; icon: React.ReactNode; title: string; meta?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`csec ${open ? 'open' : ''}`} id={id}>
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
