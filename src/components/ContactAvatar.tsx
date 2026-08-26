import { useEffect, useState } from 'react'
import { initials } from '../lib/auth'

/**
 * Avatar d'un contact, façon CRM moderne (Attio/Folk/HubSpot). Cascade de repli
 * automatique, on n'affiche jamais une image cassée :
 *   1. photo de profil (Google People, auto-hébergée dans Supabase Storage) ;
 *   2. logo de l'entreprise déduit du domaine email/société (service public) ;
 *   3. monogramme d'initiales (toujours disponible).
 *
 * Le dimensionnement et la forme sont laissés au conteneur parent
 * (`.dxa-logo`, `.v48-avatar-wrap`…), donc réutilisable partout sans style en dur.
 */
type Tier = 'photo' | 'logo' | 'logo2' | 'initials'

function cleanDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  // Accepte un email, une URL ou un domaine nu → renvoie le domaine.
  const fromEmail = raw.includes('@') ? raw.split('@')[1] : raw
  const host = (fromEmail ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? ''
  // Ignore les domaines génériques (webmail) : leur logo n'apporte rien.
  const GENERIC = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.[a-z.]+|yahoo\.[a-z.]+|live\.[a-z.]+|icloud\.com|proton(mail)?\.(com|me)|orange\.fr|free\.fr|wanadoo\.fr|sfr\.fr|laposte\.net)$/
  if (!host || !host.includes('.') || GENERIC.test(host)) return null
  return host
}

export function ContactAvatar({ src, name, domain }: { src?: string | null; name: string; domain?: string | null }) {
  const logoDomain = cleanDomain(domain)
  const first: Tier = src ? 'photo' : logoDomain ? 'logo' : 'initials'
  const [tier, setTier] = useState<Tier>(first)
  // Réinitialise si le contact change (src/domain différents).
  useEffect(() => { setTier(first) }, [src, logoDomain]) // eslint-disable-line react-hooks/exhaustive-deps

  if (tier === 'photo' && src) {
    return <img src={src} alt="" loading="lazy" onError={() => setTier(logoDomain ? 'logo' : 'initials')} />
  }
  if (tier === 'logo' && logoDomain) {
    // Logo d'entreprise à la volée. Clearbit (logo.clearbit.com) a été arrêté fin
    // 2025 → on utilise DuckDuckGo (renvoie 404 si inconnu → repli propre).
    return <img src={`https://icons.duckduckgo.com/ip3/${logoDomain}.ico`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setTier('logo2')} />
  }
  if (tier === 'logo2' && logoDomain) {
    // 2e source pour maximiser la couverture (favicon Google haute résolution).
    return <img src={`https://www.google.com/s2/favicons?sz=128&domain=${logoDomain}`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setTier('initials')} />
  }
  return <span>{initials(name)}</span>
}
