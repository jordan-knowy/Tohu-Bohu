// Backfill one-off des photos de fiches Personne — même logique que l'edge
// function enrich-contact-avatars, exécuté maintenant pour un org donné.
// Gravatar (vraie photo) → logo d'entreprise (DuckDuckGo) → rien (initiales).
// Auto-hébergé dans le bucket public `contact-avatars`.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const SUPABASE_URL = process.env.SB_URL
const KEY = process.env.SB_SR
const ORG = process.env.ORG_ID
const TRACKED_ONLY = process.env.TRACKED === '1'
const LIMIT = Number(process.env.LIMIT ?? (TRACKED_ONLY ? 500 : 2000))
if (!SUPABASE_URL || !KEY || !ORG) { console.error('Env manquante (SB_URL/SB_SR/ORG_ID)'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } })

const FREE = new Set([
  'gmail.com','googlemail.com','outlook.com','outlook.fr','hotmail.com','hotmail.fr','live.com','live.fr','msn.com',
  'yahoo.com','yahoo.fr','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','gmx.com','gmx.fr',
  'orange.fr','wanadoo.fr','free.fr','sfr.fr','laposte.net','bbox.fr','numericable.fr',
])
const corpDomain = (email) => { const d = email.split('@')[1]?.toLowerCase() || ''; return d.includes('.') && !FREE.has(d) ? d : null }
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

async function fetchAndStore(path, url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!ct.startsWith('image/')) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!buf.length || buf.length > 5_000_000) return null
    const ext = ct.includes('png') ? 'png' : ct.includes('svg') ? 'svg' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : ct.includes('icon') ? 'ico' : 'jpg'
    const full = `${path}.${ext}`
    const { error } = await supabase.storage.from('contact-avatars').upload(full, buf, { contentType: ct, upsert: true })
    if (error) return null
    const { data } = supabase.storage.from('contact-avatars').getPublicUrl(full)
    return data?.publicUrl || null
  } catch { return null }
}

let q = supabase.from('contacts').select('id,email,is_tracked')
  .eq('organization_id', ORG).is('merged_into_contact_id', null).is('avatar_url', null).not('email', 'is', null)
  .order('is_tracked', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT)
if (TRACKED_ONLY) q = q.eq('is_tracked', true)
const { data: contacts, error } = await q
if (error) { console.error(error); process.exit(1) }

const logoCache = new Map()
let gravatar = 0, logos = 0, none = 0, i = 0
for (const c of contacts) {
  i++
  const email = String(c.email || '').trim().toLowerCase()
  if (!email.includes('@')) { none++; continue }
  let url = await fetchAndStore(`${ORG}/${c.id}`, `https://www.gravatar.com/avatar/${sha256(email)}?d=404&s=256`)
  let kind = 'gravatar'
  if (!url) {
    const dom = corpDomain(email)
    if (dom) {
      if (!logoCache.has(dom)) logoCache.set(dom, await fetchAndStore(`${ORG}/logos/${dom}`, `https://icons.duckduckgo.com/ip3/${dom}.ico`))
      url = logoCache.get(dom); kind = 'logo'
    }
  }
  if (url) { await supabase.from('contacts').update({ avatar_url: url }).eq('id', c.id); if (kind === 'gravatar') gravatar++; else logos++ }
  else none++
  if (i % 20 === 0) console.log(`  ...${i}/${contacts.length} — gravatar ${gravatar}, logo ${logos}, none ${none}`)
}
console.log('RESULT ' + JSON.stringify({ processed: contacts.length, gravatar, logos, none }))
