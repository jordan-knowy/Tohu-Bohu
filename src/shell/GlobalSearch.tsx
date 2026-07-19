import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { globalSearch } from '../services/data'

type SearchRow = Awaited<ReturnType<typeof globalSearch>>[number]

/** Recherche globale de la topbar — même design que le shell historique (.global-search). */
export default function GlobalSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const [rows, setRows] = useState<SearchRow[]>([])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef(0)

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onClick = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick) }
  }, [])

  const onInput = (value: string) => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void globalSearch(value).then((results) => { setRows(results); setOpen(results.length > 0) }).catch(() => setOpen(false))
    }, 220)
  }

  const openRow = (row: SearchRow) => {
    setOpen(false)
    navigate(row.type === 'account' ? `/app/accounts/${row.id}` : `/app/people/${row.id}`)
  }

  return <div className="global-search" ref={rootRef}>
    <span>⌕</span>
    <input type="search" placeholder="Rechercher un compte, une personne…" autoComplete="off" aria-label="Recherche globale" onChange={(event) => onInput(event.target.value)} />
    {open && <div className="search-results">
      {rows.map((row) => <button type="button" className="search-result" key={`${row.type}-${row.id}`} onClick={() => openRow(row)}><b>{row.name}</b><span>{row.meta}</span></button>)}
    </div>}
  </div>
}
