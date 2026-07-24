import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from './notifications'

const POLL_MS = 60_000

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(delta) || delta < 0) return ''
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}

/** Cloche de notifications de la topbar — centre Tohu (SPEC-08 : préparation de réunion, digest). */
export default function NotificationBell({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = () => void listNotifications(userId).then(setRows).catch(() => { /* silencieux : ne bloque pas la navigation */ })

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onClick = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick) }
  }, [])

  const unreadCount = rows.filter((row) => row.readAt === null).length

  const openRow = (row: NotificationRow) => {
    setOpen(false)
    if (row.readAt === null) {
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, readAt: new Date().toISOString() } : item))
      void markNotificationRead(row.id).catch(() => refresh())
    }
    if (row.link) navigate(row.link)
  }

  const dismiss = (event: React.MouseEvent, id: string) => {
    event.stopPropagation()
    setRows((current) => current.filter((item) => item.id !== id))
    void dismissNotification(id).catch(() => refresh())
  }

  const markAll = () => {
    setRows((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })))
    void markAllNotificationsRead(userId).catch(() => refresh())
  }

  return <div className="notif-bell" ref={rootRef}>
    <button type="button" className="notif-bell-btn" aria-label={unreadCount ? `${unreadCount} notification${unreadCount > 1 ? 's' : ''} non lue${unreadCount > 1 ? 's' : ''}` : 'Notifications'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
      {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {open && <div className="notif-panel" role="menu" aria-label="Notifications">
      <div className="notif-panel-head">
        <span>Notifications</span>
        {unreadCount > 0 && <button type="button" onClick={markAll}>Tout marquer comme lu</button>}
      </div>
      {!rows.length
        ? <div className="notif-empty">Aucune notification pour l’instant.</div>
        : <div className="notif-list">{rows.map((row) => <div key={row.id} role="menuitem" tabIndex={0} className={`notif-item ${row.readAt === null ? 'unread' : ''}`} onClick={() => openRow(row)} onKeyDown={(event) => { if (event.key === 'Enter') openRow(row) }}>
          <span className={`notif-dot ${row.priority}`} aria-hidden="true" />
          <span className="notif-body">
            <span className="notif-title">{row.title}</span>
            {row.body && <span className="notif-text">{row.body}</span>}
            <span className="notif-time">{relativeTime(row.createdAt)}</span>
          </span>
          <button type="button" className="notif-dismiss" aria-label="Écarter" onClick={(event) => dismiss(event, row.id)}>✕</button>
        </div>)}</div>}
    </div>}
  </div>
}
