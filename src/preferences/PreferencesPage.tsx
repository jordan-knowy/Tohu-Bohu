import { useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { tohuLogo } from '../components/logo'
import '../styles/tokens.css'
import '../styles/fonts.css'

type Prefs = {
  digest_enabled: boolean
  antiseche_enabled: boolean
  alerte_enabled: boolean
  onboarding_enabled: boolean
  unsubscribed_all: boolean
}
const DEFAULTS: Prefs = { digest_enabled: true, antiseche_enabled: true, alerte_enabled: true, onboarding_enabled: true, unsubscribed_all: false }

const ROWS: Array<{ key: keyof Prefs; title: string; desc: string }> = [
  { key: 'digest_enabled', title: 'Digest hebdomadaire', desc: 'Le point du lundi 8 h : comptes qui bougent, engagements, temps forts, veille.' },
  { key: 'antiseche_enabled', title: 'Antisèche de réunion', desc: 'La prépa envoyée avant chaque réunion : engagements, profil de l’interlocuteur, entreprise.' },
  { key: 'alerte_enabled', title: 'Alertes', desc: 'Un signal fort sur un compte suivi (mobilité, levée, marché). Maximum 3 par semaine.' },
  { key: 'onboarding_enabled', title: 'Messages de prise en main', desc: 'La courte série d’accueil pour bien démarrer avec Tohu.' },
]

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 46, height: 27, borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: 3, flex: '0 0 auto', opacity: disabled ? 0.5 : 1, background: on && !disabled ? 'linear-gradient(135deg,#6E50C8,#E14FA0)' : '#D8D1E8', transition: 'background .2s' }}>
      <span style={{ display: 'block', width: 21, height: 21, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(19px)' : 'translateX(0)', transition: 'transform .2s' }} />
    </button>
  )
}

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => { void load() }, [])
  async function load() {
    const { data: { user } } = await getSupabase().auth.getUser()
    if (!user) { setNeedLogin(true); return }
    setUserId(user.id)
    const { data } = await getSupabase().from('email_preferences').select('digest_enabled,antiseche_enabled,alerte_enabled,onboarding_enabled,unsubscribed_all').eq('user_id', user.id).maybeSingle()
    setPrefs(data ?? DEFAULTS)
  }

  async function persist(next: Prefs) {
    if (!userId) return
    setPrefs(next)
    setStatus('saving')
    const { error } = await getSupabase().from('email_preferences').upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setStatus(error ? 'error' : 'saved')
    if (!error) setTimeout(() => setStatus('idle'), 1800)
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#F7F5FB', display: 'flex', justifyContent: 'center', padding: '48px 18px', fontFamily: "'Epilogue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }
  const card: React.CSSProperties = { width: '100%', maxWidth: 620, background: '#fff', borderRadius: 18, border: '1px solid #ECE8F5', padding: '34px 34px 28px', boxShadow: '0 10px 40px rgba(60,52,137,.06)' }

  if (needLogin) return (
    <div style={wrap}><div style={{ ...card, textAlign: 'center' }}>
      <div style={{ height: 26, marginBottom: 18 }} dangerouslySetInnerHTML={{ __html: tohuLogo('Tohu') }} />
      <h1 style={{ fontSize: 22, color: '#1A1040', margin: '0 0 8px' }}>Gérer mes e-mails</h1>
      <p style={{ color: '#6B6480', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }}>Connecte-toi pour régler la fréquence ou te désabonner.</p>
      <a href="/connexion" style={{ display: 'inline-block', padding: '13px 28px', borderRadius: 12, color: '#fff', fontWeight: 700, background: 'linear-gradient(135deg,#6E50C8,#E14FA0)' }}>Se connecter</a>
    </div></div>
  )
  if (!prefs) return <div style={wrap}><div style={card}>Chargement…</div></div>

  const allOff = prefs.unsubscribed_all
  return (
    <div style={wrap}><div style={card}>
      <div style={{ height: 24, marginBottom: 22 }} dangerouslySetInnerHTML={{ __html: tohuLogo('Tohu') }} />
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.6px', color: '#1A1040', margin: '0 0 6px' }}>Préférences e-mail</h1>
      <p style={{ color: '#6B6480', fontSize: 14, lineHeight: 1.5, margin: '0 0 24px' }}>Choisis ce que Tohu t’envoie. Modifications enregistrées automatiquement.</p>

      {ROWS.map((row) => (
        <div key={row.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 0', borderTop: '1px solid #F0ECF7' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1040' }}>{row.title}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B839F', marginTop: 3 }}>{row.desc}</div>
          </div>
          <Toggle on={!allOff && prefs[row.key]} disabled={allOff} onChange={(v) => persist({ ...prefs, [row.key]: v })} />
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 0 4px', marginTop: 10, borderTop: '2px solid #F0ECF7' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#D94F63' }}>Tout désactiver</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B839F', marginTop: 3 }}>Ne plus recevoir aucun e-mail de Tohu.</div>
        </div>
        <Toggle on={allOff} onChange={(v) => persist({ ...prefs, unsubscribed_all: v })} />
      </div>

      <div style={{ marginTop: 22, fontSize: 12, color: status === 'error' ? '#D94F63' : '#2EA86A', minHeight: 18 }}>
        {status === 'saving' && 'Enregistrement…'}
        {status === 'saved' && '✓ Préférences enregistrées'}
        {status === 'error' && 'Impossible d’enregistrer, réessaie.'}
      </div>
      <p style={{ marginTop: 18, fontSize: 11.5, color: '#9A93AC', lineHeight: 1.6, borderTop: '1px solid #F0ECF7', paddingTop: 16 }}>
        Tohu · Optee SAS · données hébergées en UE · lecture seule. Le digest part chaque lundi à 8 h (Europe/Paris).
      </p>
    </div></div>
  )
}
