import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase'
import { signOut } from '../../lib/auth'
import { getProfile, type ProfileRow } from '../../services/data'
import { useToast } from '../../person-detail/ui'

type PageContext = { session: Session; workspaceId: string }
type Preferences = { email_enabled: boolean; push_enabled: boolean; daily_digest_enabled: boolean }

const PREFERENCE_ROWS: Array<{ key: keyof Preferences; title: string; copy: string }> = [
  { key: 'email_enabled', title: 'Notifications email', copy: 'Alertes importantes' },
  { key: 'push_enabled', title: 'Notifications push', copy: 'Nouveaux signaux importants' },
  { key: 'daily_digest_enabled', title: 'Digest quotidien', copy: 'Résumé à l’heure configurée' },
]

/** Mon compte — port fidèle de la vue « me » du shell historique (mêmes classes settings-*, switch, plan-card). */
export default function AccountSettingsPage({ context }: { context: PageContext }) {
  const toast = useToast()
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [preferences, setPreferences] = useState<Preferences>({ email_enabled: true, push_enabled: true, daily_digest_enabled: true })
  const [plan, setPlan] = useState({ id: 'free', status: 'active' })
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ full_name: '', avatar_url: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const client = getSupabase()
    void Promise.all([
      getProfile(context.session.user.id),
      client.from('notification_preferences').select('*').eq('user_id', context.session.user.id).eq('organization_id', context.workspaceId).maybeSingle(),
      client.from('subscriptions').select('*').eq('organization_id', context.workspaceId).maybeSingle(),
    ]).then(([profileRow, preferencesResult, subscriptionResult]) => {
      if (preferencesResult.error) throw preferencesResult.error
      if (subscriptionResult.error) throw subscriptionResult.error
      setProfile(profileRow)
      setForm({ full_name: profileRow.full_name, avatar_url: profileRow.avatar_url ?? '' })
      if (preferencesResult.data) setPreferences(preferencesResult.data as Preferences)
      setPlan({ id: subscriptionResult.data?.plan_id ?? 'free', status: subscriptionResult.data?.status ?? 'active' })
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Une erreur inattendue est survenue.'))
  }, [context.session.user.id, context.workspaceId])

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const values = { full_name: form.full_name.trim(), avatar_url: form.avatar_url.trim() || null }
      const { error: updateError } = await getSupabase().from('profiles').update(values).eq('id', context.session.user.id)
      if (updateError) throw updateError
      toast('Informations enregistrées.')
      // La sidebar (AppShell) affiche nom/avatar : on lui signale la mise à jour.
      window.dispatchEvent(new CustomEvent('tohu:profile-updated'))
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Impossible d’enregistrer.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const togglePreference = async (key: keyof Preferences) => {
    const enabled = !preferences[key]
    try {
      const { error: updateError } = await getSupabase().from('notification_preferences').update({ [key]: enabled }).eq('organization_id', context.workspaceId).eq('user_id', context.session.user.id)
      if (updateError) throw updateError
      setPreferences((current) => ({ ...current, [key]: enabled }))
      toast('Préférence enregistrée.')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Préférence non enregistrée.', 'error')
    }
  }

  if (error) return <div className="inline-error">{error}</div>
  if (!profile) return <div className="loading-state"><span className="spinner" /></div>

  return <div className="settings-grid">
    <section className="panel">
      <header className="panel-head"><span className="panel-ic">◎</span><span><span className="panel-title">Informations du compte</span><span className="panel-sub">Modifiables et persistées dans Supabase</span></span></header>
      <form className="panel-body settings-form" onSubmit={(event) => void saveProfile(event)}>
        <div className="field"><label htmlFor="settings-name">Nom complet</label><input className="input" id="settings-name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} required /></div>
        <div className="field"><label htmlFor="settings-email">Email</label><input className="input" id="settings-email" value={context.session.user.email ?? ''} disabled /></div>
        <div className="field"><label htmlFor="settings-avatar">URL de l’avatar</label><input className="input" id="settings-avatar" value={form.avatar_url} onChange={(event) => setForm((current) => ({ ...current, avatar_url: event.target.value }))} placeholder="https://…" /></div>
        <button className="btn-view" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>
    </section>
    <section className="panel">
      <header className="panel-head"><span className="panel-ic">⌁</span><span><span className="panel-title">Notifications</span><span className="panel-sub">Choisis les alertes utiles</span></span></header>
      <div className="panel-body">
        {PREFERENCE_ROWS.map((row) => <div className="switch-row" key={row.key}>
          <span><b>{row.title}</b><small>{row.copy}</small></span>
          <button type="button" className={`switch ${preferences[row.key] ? 'on' : ''}`} onClick={() => void togglePreference(row.key)} aria-pressed={preferences[row.key]}><i /></button>
        </div>)}
      </div>
    </section>
    <section className="panel plan-card">
      <header className="panel-head"><span><span className="panel-title">Abonnement</span><span className="panel-sub">Plan de l’organisation</span></span></header>
      <div className="panel-body">
        <div className="plan-name">Tohu {plan.id}</div>
        <p className="plan-copy">Statut : {plan.status}. La facturation n’est pas encore gérée depuis cette interface.</p>
      </div>
    </section>
    <section className="panel">
      <header className="panel-head"><span><span className="panel-title">Session</span><span className="panel-sub">Sécurité de ton compte</span></span></header>
      <div className="panel-body"><button type="button" className="btn-secondary" onClick={() => void signOut()}>Se déconnecter</button></div>
    </section>
    <section className="panel danger-zone wide">
      <header className="panel-head"><span><span className="panel-title">Zone sensible</span><span className="panel-sub">Actions irréversibles</span></span></header>
      <div className="panel-body">
        <p>La suppression complète nécessite une fonction serveur qui efface Auth et toutes les données associées.</p>
        <button className="btn-danger" disabled title="À brancher sur une Edge Function administrateur">Supprimer mon compte — bientôt disponible</button>
      </div>
    </section>
  </div>
}
