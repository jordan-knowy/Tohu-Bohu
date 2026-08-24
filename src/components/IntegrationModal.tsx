import { useEffect, useMemo, useRef, useState } from 'react'

/** Un élément détecté (compte ou personne) affiché dans le tableau de détection.
 *  Les champs optionnels (interlocuteurs, ancienneté, relation) ne sont rendus
 *  que s'ils sont fournis — l'enrichissement des RPC de détection est une étape 2. */
export type IntegrationItem = {
  id: string
  name: string
  subtitle?: string | null
  interactions: number
  lastInteractionAt: string | null
  alreadyTracked?: boolean
  avatarUrl?: string | null
  interlocutors?: string[]
  interlocutorCount?: number
  ageLabel?: string | null
  relation?: { label: string; color: string } | null
}

type SortKey = 'name' | 'interactions' | 'lastInteractionAt'
const PRECHECK = 10

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function relLabel(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days} j`
  if (days < 365) return `il y a ${Math.round(days / 30)} mois`
  return `il y a ${Math.round(days / 365)} an${days >= 730 ? 's' : ''}`
}

/** Ancienneté = durée depuis le premier échange observé. */
export function ageSince(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days < 45) return 'récent'
  const months = Math.round(days / 30)
  if (months < 12) return `${months} mois`
  const years = Math.round(days / 365)
  return `${years} an${years > 1 ? 's' : ''}`
}

const SearchIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" strokeLinecap="round" /></svg>

export function IntegrationModal({ entity, title, subtitle, items, loading, error, busy, onConfirm, onClose }: {
  entity: 'compte' | 'personne'
  title: string
  subtitle?: React.ReactNode
  items: IntegrationItem[] | null
  loading: boolean
  error: string | null
  busy?: boolean
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('interactions')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [relFilter, setRelFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [calculating, setCalculating] = useState(false)
  const inited = useRef(false)

  // Pré-sélection une fois : les PRECHECK plus actifs (+ déjà suivis).
  useEffect(() => {
    if (inited.current || !items) return
    inited.current = true
    const init = new Set<string>()
    ;[...items].sort((a, b) => b.interactions - a.interactions).forEach((item, index) => {
      if (item.alreadyTracked || index < PRECHECK) init.add(item.id)
    })
    setSelected(init)
  }, [items])

  const relations = useMemo(() => {
    const map = new Map<string, { label: string; color: string; count: number }>()
    for (const item of items ?? []) {
      if (!item.relation) continue
      const current = map.get(item.relation.label)
      if (current) current.count += 1
      else map.set(item.relation.label, { ...item.relation, count: 1 })
    }
    return [...map.values()]
  }, [items])

  const hasInterlocutors = useMemo(() => (items ?? []).some((item) => (item.interlocutorCount ?? item.interlocutors?.length ?? 0) > 0), [items])
  const hasRelation = relations.length > 0

  const displayed = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => !q || item.name.toLowerCase().includes(q) || (item.subtitle ?? '').toLowerCase().includes(q))
      .filter((item) => !relFilter || item.relation?.label === relFilter)
      .sort((a, b) => {
        const cmp = sortKey === 'name'
          ? a.name.localeCompare(b.name)
          : sortKey === 'interactions'
            ? a.interactions - b.interactions
            : (a.lastInteractionAt ?? '').localeCompare(b.lastInteractionAt ?? '')
        return cmp * sortDir
      })
  }, [items, query, relFilter, sortKey, sortDir])

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDir((dir) => (dir === 1 ? -1 : 1))
    else { setSortKey(key); setSortDir(-1) }
  }
  const arrow = (key: SortKey) => sortKey === key ? <span className="ar">{sortDir === 1 ? '▴' : '▾'}</span> : null

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const displayedIds = displayed.map((item) => item.id)
  const allDisplayedSelected = displayedIds.length > 0 && displayedIds.every((id) => selected.has(id))
  const toggleAllDisplayed = () => setSelected((current) => {
    const next = new Set(current)
    if (allDisplayedSelected) displayedIds.forEach((id) => next.delete(id))
    else displayedIds.forEach((id) => next.add(id))
    return next
  })

  const confirm = () => {
    if (!selected.size) return
    setCalculating(true)
    onConfirm([...selected])
  }

  const entityPlural = entity === 'compte' ? 'comptes' : 'personnes'

  return <div className="tin-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="tin" role="dialog" aria-modal="true" aria-label={title}>
      <div className="tin-head">
        <div>
          <p className="tin-eyebrow">Détection · faits observables</p>
          <h1 className="tin-h">{title}</h1>
          {subtitle && <p className="tin-sub">{subtitle}</p>}
        </div>
        <button type="button" className="tin-x" aria-label="Fermer" onClick={onClose} disabled={busy}>×</button>
      </div>

      {calculating || busy
        ? <div className="tin-tblwrap"><div className="tin-state"><span className="spin" /><span>Calcul de l'index relationnel…<br />Les scores tombent un par un, ta sélection est en cours d'intégration.</span></div></div>
        : loading
          ? <div className="tin-tblwrap"><div className="tin-state"><span className="spin" /><span>Détection en cours — lecture de tes échanges…</span></div></div>
          : error
            ? <div className="tin-tblwrap"><div className="tin-state">{error}</div></div>
            : !items || !items.length
              ? <div className="tin-tblwrap"><div className="tin-state">Aucun {entity} détecté dans tes échanges pour l'instant.</div></div>
              : <>
                  <div className="tin-toolbar">
                    <div className="tin-search">{SearchIcon}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Rechercher un ${entity}…`} aria-label={`Rechercher un ${entity}`} /></div>
                  </div>
                  {hasRelation && <div className="tin-chips">
                    <button type="button" className={`tin-chip${relFilter === null ? ' on' : ''}`} onClick={() => setRelFilter(null)}>Tous <span className="n">{items.length}</span></button>
                    {relations.map((rel) => <button type="button" key={rel.label} className={`tin-chip${relFilter === rel.label ? ' on' : ''}`} onClick={() => setRelFilter(rel.label)}>{rel.label} <span className="n">{rel.count}</span></button>)}
                  </div>}
                  <div className="tin-tblwrap">
                    <table className="tin-tbl">
                      <thead><tr>
                        <th className="nosort"><span className={`tin-ck${allDisplayedSelected ? ' on' : ''}`} onClick={toggleAllDisplayed} role="checkbox" aria-checked={allDisplayedSelected} aria-label="Tout sélectionner" /></th>
                        <th className={sortKey === 'name' ? 'sorted' : ''} onClick={() => sortBy('name')}>{entity === 'compte' ? 'Compte' : 'Personne'} {arrow('name')}</th>
                        {hasInterlocutors && <th className="nosort opt">Interlocuteurs</th>}
                        <th className={`opt ${sortKey === 'interactions' ? 'sorted' : ''}`} onClick={() => sortBy('interactions')}>Historique {arrow('interactions')}</th>
                        <th className={sortKey === 'lastInteractionAt' ? 'sorted' : ''} onClick={() => sortBy('lastInteractionAt')}>Dernier échange {arrow('lastInteractionAt')}</th>
                        {hasRelation && <th className="nosort opt">Relation</th>}
                      </tr></thead>
                      <tbody>
                        {displayed.map((item) => {
                          const on = selected.has(item.id)
                          return <tr key={item.id} className={on ? 'sel' : ''} onClick={() => toggle(item.id)}>
                            <td><span className={`tin-ck${on ? ' on' : ''}`} role="checkbox" aria-checked={on} /></td>
                            <td><div className="tin-ent">
                              <span className="tin-av">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : initials(item.name)}</span>
                              <div><b>{item.name}</b>{item.subtitle && <small>{item.subtitle}</small>}</div>
                            </div></td>
                            {hasInterlocutors && (() => {
                              const shown = item.interlocutors ?? []
                              const count = item.interlocutorCount ?? shown.length
                              return <td className="opt">{count > 0
                                ? <span className="tin-il">{shown.slice(0, 3).map((label, i) => <i key={i}>{label || '·'}</i>)}{count > 3 && <span className="more">+{count - 3}</span>}</span>
                                : <span className="tin-muted">—</span>}</td>
                            })()}
                            <td className="opt tin-hist"><b>{item.interactions}</b> échange{item.interactions > 1 ? 's' : ''}{item.ageLabel && <small>· {item.ageLabel}</small>}</td>
                            <td>{relLabel(item.lastInteractionAt)}</td>
                            {hasRelation && <td className="opt">{item.relation
                              ? <span className="tin-rel"><span className="d" style={{ background: item.relation.color }} />{item.relation.label}</span>
                              : <span className="tin-muted">—</span>}</td>}
                          </tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="tin-foot">
                    <div className="tin-foot-l"><b>{selected.size}</b> {entityPlural} sélectionné{selected.size > 1 ? 's' : ''} sur {items.length} · <button type="button" className="tin-selall" onClick={toggleAllDisplayed}>{allDisplayedSelected ? 'Tout désélectionner' : 'Tout sélectionner'} (affichés)</button></div>
                    <button type="button" className="tin-cta" disabled={!selected.size} onClick={confirm}>Calculer l'index relationnel <span aria-hidden="true">→</span></button>
                  </div>
                </>}
    </div>
  </div>
}

export default IntegrationModal
