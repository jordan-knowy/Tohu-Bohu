import { useState } from 'react'
import { initials } from '../lib/auth'

/**
 * Avatar d'un contact : photo de profil (via Google People, auto-hébergée dans
 * Supabase Storage) quand elle existe, sinon initiales.
 *
 * Bascule automatiquement sur les initiales si l'image ne se charge pas (URL
 * indisponible, hors-ligne, source distante bloquée…) — on n'affiche jamais une
 * image cassée. Le dimensionnement et la forme sont laissés au conteneur parent
 * (`.dxa-logo`, `.v48-avatar-wrap`…), donc ce composant reste réutilisable
 * partout sans style en dur.
 */
export function ContactAvatar({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  return <span>{initials(name)}</span>
}
