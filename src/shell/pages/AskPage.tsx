import { useEffect, useRef, useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase'
import { getProfile } from '../../services/data'
import { parseBohuAnswer, parseInline, type AskSection } from '../askFormat'

type ShellContext = { session: { user: { id: string } }; workspaceId: string }
type Message = { role: 'user' | 'assistant'; content: string; pending?: boolean }

const SCOPES = [
  { value: 'organisation', label: 'Mon organisation' },
  { value: 'comptes', label: 'Mes comptes' },
  { value: 'contacts', label: 'Mes contacts' },
]
// Placeholder-fantôme rotatif (catégorie + exemple), repris de la maquette.
const ROTATION = [
  { c: 'Commerce', col: '#6E50C8', ex: 'Qui décide vraiment sur mes comptes clés ?' },
  { c: 'Produit', col: '#2896A8', ex: 'Les remontées produit les plus importantes sur 6 mois ?' },
  { c: 'CSM', col: '#2EA86A', ex: 'Mes 3 plus grandes alertes de santé relationnelle ?' },
  { c: 'Operations', col: '#C97A20', ex: 'Quelles relations partent si un collègue quitte la boîte ?' },
]
// Suggestions cliquables de l'état vide — même esprit que ROTATION mais actionnables.
const SUGGESTIONS = [
  'Où concentrer mes efforts relationnels cette semaine ?',
  'Quels comptes sont les plus fragiles ?',
  'Résume les signaux importants des 7 derniers jours.',
  'Qui dois-je relancer en priorité ?',
]
const RECENT_KEY = 'tohu-ask-recent'
const COMPOSER_MAX_HEIGHT = 150

/** Marque Bohu — logo réseau Tohu (blanc), repris à l'identique de la maquette. */
const BohuMark = (
  <svg viewBox="43 25 72 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="translate(6,-5)" fill="#fff">
      <line x1="60" y1="62" x2="80" y2="42" stroke="#fff" strokeWidth="2.6" />
      <line x1="60" y1="62" x2="94" y2="66" stroke="#fff" strokeWidth="2.6" />
      <line x1="60" y1="62" x2="76" y2="90" stroke="#fff" strokeWidth="2.6" />
      <line x1="60" y1="62" x2="52" y2="46" stroke="#fff" strokeWidth="2.6" />
      <circle cx="80" cy="42" r="4.6" />
      <circle cx="94" cy="66" r="4" />
      <circle cx="76" cy="90" r="4" />
      <circle cx="52" cy="46" r="3.6" />
      <circle cx="60" cy="62" r="7.6" />
    </g>
  </svg>
)

/** Flèche d'envoi (SVG, repris de la maquette). */
const SendArrow = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** Fond constellation décoratif (n'apparaît que sur l'état vide) — repris de la maquette. */
const Constellation = (
  <svg className="ask-constellation" viewBox="0 0 1050 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g stroke="#6E50C8" strokeWidth="1" opacity="0.55" fill="none">
      <path d="M120 180 L300 120 M300 120 L470 210 M470 210 L520 350 M520 350 L390 410 M300 120 L250 300 M250 300 L390 410 M650 150 L790 230 M790 230 L910 190 M650 150 L520 220 M520 220 L470 210 M790 230 L740 380 M740 380 L520 350 M390 410 L480 520 M480 520 L660 500 M660 500 L740 380" />
    </g>
    <g fill="#6E50C8">
      <circle cx="120" cy="180" r="3" opacity="0.35" /><circle cx="300" cy="120" r="4" opacity="0.5" />
      <circle cx="250" cy="300" r="3.5" opacity="0.4" /><circle cx="390" cy="410" r="3" opacity="0.35" />
      <circle cx="520" cy="350" r="4" opacity="0.45" /><circle cx="650" cy="150" r="4" opacity="0.5" />
      <circle cx="790" cy="230" r="3.5" opacity="0.4" /><circle cx="910" cy="190" r="3" opacity="0.3" />
      <circle cx="740" cy="380" r="3.5" opacity="0.4" /><circle cx="480" cy="520" r="3" opacity="0.3" />
      <circle cx="660" cy="500" r="3.5" opacity="0.35" />
    </g>
    <circle cx="470" cy="210" r="8" fill="#2EA86A" opacity="0.5" />
    <circle cx="520" cy="220" r="6" fill="#2896A8" opacity="0.5" />
  </svg>
)

/** Segment de texte avec gras ciblé (`**mot**` → `<strong>`) — jamais de HTML brut. */
function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((token, i) => token.bold ? <strong key={i}>{token.text}</strong> : token.text)}</>
}

/** Rendu d'une réponse Bohu déjà découpée en sections (résumé / points clés /
 *  pourquoi / recommandations / sources) — cf. askFormat.ts. Une réponse sans
 *  titre reconnu retombe sur un simple paragraphe, comportement inchangé. */
function BohuAnswer({ content }: { content: string }) {
  return <div className="message assistant">
    {parseBohuAnswer(content).map((section: AskSection, index) => {
      const facts = section.facts.length > 0 && <div className="bohu-facts">
        {section.facts.map((fact, i) => <div className="fact" key={i}><span>{fact.label}</span><b><Inline text={fact.value} /></b></div>)}
      </div>
      const paragraphs = section.paragraphs.map((paragraph, i) => <p className="bohu-lead" key={i}><Inline text={paragraph} /></p>)
      if (section.kind === 'sources') {
        return <div className="bohu-sources" key={index}>
          <p className="bohu-sources-h">{section.heading ?? 'Sources'}</p>
          {paragraphs}
          {section.items.length > 0 && <ul>{section.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>}
        </div>
      }
      const isRecommend = section.kind === 'recommend'
      return <div className="bohu-section" key={index}>
        {section.heading && <p className={`sread-h${isRecommend ? ' next' : ''}`}>{section.heading}</p>}
        {facts}
        {paragraphs}
        {section.items.length > 0 && <ul className={`sread-list${isRecommend ? ' next' : ' neutral'}`}>{section.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>}
      </div>
    })}
  </div>
}

/** Ask Bohu — mode conversation refondu : fil pleine hauteur, réponses structurées, composer ancré. */
export default function AskPage() {
  const location = useLocation()
  const { session } = useOutletContext<ShellContext>()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [firstName, setFirstName] = useState('')
  const [scopeIndex, setScopeIndex] = useState(0)
  const [rotIndex, setRotIndex] = useState(0)
  const [rotFade, setRotFade] = useState(false)
  const [focused, setFocused] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
  })
  const [showRecent, setShowRecent] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const sending = messages.some((item) => item.pending)

  useEffect(() => {
    getProfile(session.user.id)
      .then((profile) => {
        const first = (profile.full_name ?? '').trim().split(/\s+/)[0] ?? ''
        if (first) setFirstName(first.charAt(0).toLocaleUpperCase('fr-FR') + first.slice(1))
      })
      .catch(() => {})
  }, [session.user.id])

  useEffect(() => {
    // Question envoyée depuis la barre Bohu globale (state.ask) → envoi immédiat.
    // Sinon préremplissage : navigation depuis Home (state.prefill) ou lien legacy ?mode=simulation.
    const state = location.state as { prefill?: string; ask?: string; scope?: string } | null
    if (state?.scope) { const index = SCOPES.findIndex((item) => item.value === state.scope); if (index >= 0) setScopeIndex(index) }
    if (state?.ask) { ask(state.ask); return }
    const prefill = state?.prefill
      ?? (new URLSearchParams(location.search).get('mode') === 'simulation' ? 'Mode simulation — je veux préparer un échange. Situation : ' : null)
    if (prefill) setDraft(prefill)
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages])

  // Rotation du placeholder-fantôme (pause si focus ou saisie en cours).
  useEffect(() => {
    if (focused || draft) return
    const id = setInterval(() => {
      setRotFade(true)
      setTimeout(() => { setRotIndex((index) => (index + 1) % ROTATION.length); setRotFade(false) }, 420)
    }, 3000)
    return () => clearInterval(id)
  }, [focused, draft])

  // Composer auto-grandissant (multi-ligne), plafonné par COMPOSER_MAX_HEIGHT (cf. CSS .ask-inwrap textarea).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [draft])

  const pushRecent = (question: string) => {
    setRecent((current) => {
      const next = [question, ...current.filter((item) => item !== question)].slice(0, 8)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
      return next
    })
  }

  const ask = (message: string) => {
    if (sending) return
    const trimmed = message.trim()
    if (!trimmed) return
    setDraft('')
    setShowRecent(false)
    pushRecent(trimmed)
    const scope = SCOPES[scopeIndex]?.value ?? 'organisation'
    const history = messages.filter((item) => !item.pending).slice(-8).map(({ role, content }) => ({ role, content }))
    setMessages((current) => [...current, { role: 'user', content: trimmed }, { role: 'assistant', content: '', pending: true }])
    // L'appel réseau reste HORS du updater setMessages (un updater doit rester pur).
    void getSupabase().functions.invoke('ask-tohu-proxy', { body: { message: trimmed, history, scope } })
      .then(({ data, error }) => {
        if (error) throw error
        const answer = String(data?.answer ?? 'Je n’ai pas pu produire de réponse à partir des données disponibles.')
        setMessages((items) => items.map((item) => item.pending ? { role: 'assistant', content: answer } : item))
      })
      .catch(async (error: unknown) => {
        // supabase-js masque le vrai message serveur derrière « non-2xx status code » :
        // la réponse réelle est dans error.context (Response) → on lit son corps JSON.
        let content = 'Impossible de répondre pour le moment.'
        const context = (error as { context?: Response }).context
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json() as { error?: string }
            if (body?.error) content = `Impossible de répondre : ${body.error}`
          } catch { /* corps illisible : on garde le message générique */ }
        } else if (error instanceof Error) {
          content = `Impossible de répondre : ${error.message}`
        }
        setMessages((items) => items.map((item) => item.pending ? { role: 'assistant', content } : item))
      })
  }

  const submitDraft = () => ask(draft)

  const empty = messages.length === 0
  const rot = ROTATION[rotIndex]!
  const scopeLabel = SCOPES[scopeIndex]?.label ?? 'Mon organisation'

  return <div className={`ask-layout${empty ? ' is-empty' : ' is-thread'}`}>
    {empty && Constellation}

    <div className="ask-top">
      <div className="ask-brand"><span className="ask-brand-ic">{BohuMark}</span>Bohu</div>
      <div className="ask-top-actions">
        <div className="ask-recent-wrap">
          <button type="button" className="ask-chip" onClick={() => setShowRecent((value) => !value)} disabled={!recent.length} aria-expanded={showRecent}>
            <span aria-hidden="true">🕘</span> Historique
          </button>
          {showRecent && <div className="ask-recent-menu" role="menu">
            <div className="ask-recent-menu-h">Questions récentes</div>
            {recent.length
              ? recent.map((question) => <button type="button" key={question} role="menuitem" onClick={() => ask(question)}>{question}</button>)
              : <div className="ask-recent-empty">Aucune question posée pour l’instant.</div>}
          </div>}
        </div>
        <button type="button" className="ask-chip primary" onClick={() => { setMessages([]); setDraft(''); setShowRecent(false); inputRef.current?.focus() }}>
          + Nouvelle
        </button>
      </div>
    </div>

    {empty
      ? <div className="ask-hero">
          <span className="ask-mark-lg">{BohuMark}</span>
          <p className="ask-kicker">Bohu · Cerveau relationnel</p>
          <h2>Que veux-tu comprendre{firstName ? `, ${firstName}` : ''} ?</h2>
          <p className="ask-sub">Pose une question sur tes comptes, tes contacts et ta team — Bohu répond avec ce qu’il a observé, daté et sourcé.</p>
          <div className="ask-suggestions">
            {SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}
          </div>
        </div>
      : <div className="ask-thread" ref={threadRef} aria-live="polite">
          {messages.map((message, index) => {
            if (message.role === 'user') return <div className="bohu-row user" key={index}><div className="message user">{message.content}</div></div>
            if (message.pending) return <div className="bohu-row assistant" key={index}>
              <span className="bohu-avatar">{BohuMark}</span>
              <div className="bohu-body"><span className="ask-dots" role="status" aria-label="Bohu écrit…"><i /><i /><i /></span></div>
            </div>
            return <div className="bohu-row assistant" key={index}>
              <span className="bohu-avatar">{BohuMark}</span>
              <div className="bohu-body"><BohuAnswer content={message.content} /></div>
            </div>
          })}
        </div>}

    <form className={`ask-composer${empty ? '' : ' is-dock'}`} onSubmit={(event) => { event.preventDefault(); submitDraft() }}>
      <button type="button" className="ask-scope" onClick={() => setScopeIndex((index) => (index + 1) % SCOPES.length)} aria-label={`Périmètre : ${scopeLabel}. Cliquer pour changer.`}>
        <span className="ask-scope-dot" aria-hidden="true" />{scopeLabel}<span className="ask-scope-caret" aria-hidden="true">▾</span>
      </button>
      <span className="ask-inwrap">
        <textarea ref={inputRef} rows={1} value={draft} aria-label="Poser une question à Bohu" disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitDraft() } }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)} />
        <span className={`ask-ghost${draft ? ' is-hidden' : ''}${rotFade ? ' is-fading' : ''}`} aria-hidden="true">
          {focused
            ? <span className="ask-ex is-stat">Demande à Bohu…</span>
            : <>
                <span className="ask-cat"><span className="ask-cat-dot" style={{ background: rot.col }} />{rot.c}</span>
                <span className="ask-ex">{rot.ex}</span>
              </>}
        </span>
      </span>
      <button type="submit" className="ask-send" aria-label="Envoyer" disabled={sending || !draft.trim()}>{SendArrow}</button>
    </form>
    <p className="ask-disclaimer">Tohu peut se tromper. Les réponses sensibles doivent être vérifiées.</p>
  </div>
}
