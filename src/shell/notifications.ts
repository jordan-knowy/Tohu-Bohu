// Centre de notifications — lit `notifications` (RLS: user_id = auth.uid()),
// alimentée par generate-briefs (préparation de réunion, digest quotidien) et
// les veilles monitor-contacts / monitor-company-news.

import { getSupabase } from '../lib/supabase'

export type NotificationPriority = 'urgent' | 'important' | 'info'

export type NotificationRow = {
  id: string
  type: string
  priority: NotificationPriority
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function mapNotification(row: Record<string, unknown>): NotificationRow {
  const priority = row.priority
  return {
    id: String(row.id),
    type: String(row.type ?? 'system'),
    priority: priority === 'urgent' || priority === 'important' ? priority : 'info',
    title: String(row.title ?? 'Notification'),
    body: typeof row.body === 'string' ? row.body : null,
    link: typeof row.link === 'string' ? row.link : null,
    readAt: typeof row.read_at === 'string' ? row.read_at : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

/** Notifications actives (non écartées) des 30 derniers jours, les plus récentes d'abord. */
export async function listNotifications(userId: string): Promise<NotificationRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('id,type,priority,title,body,link,read_at,created_at')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(String(record(error).message ?? 'Notifications indisponibles'))
  return (data ?? []).map((row) => mapNotification(record(row)))
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
  if (error) throw new Error(String(record(error).message ?? 'Notification non mise à jour'))
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)
  if (error) throw new Error(String(record(error).message ?? 'Notifications non mises à jour'))
}

export async function dismissNotification(id: string): Promise<void> {
  const { error } = await getSupabase().from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(String(record(error).message ?? 'Notification non écartée'))
}
