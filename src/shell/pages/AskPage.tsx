import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string; pending?: boolean }

const SUGGESTIONS = [
  'Quels comptes demandent mon attention ?',
  'Avec qui reprendre contact cette semaine ?',
  'Résume les derniers signaux de mon équipe',
]

/** Ask Bohu — port fidèle de la vue « cerveau » du shell historique (mêmes classes ask-*). */
export default function AskPage() {
  const location = useLocation()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Préremplissage : navigation depuis Home (state.prefill) ou lien legacy ?mode=simulation.
    const prefill = (location.state as { prefill?: string } | null)?.prefill
      ?? (new URLSearchParams(location.search).get('mode') === 'simulation' ? 'Mode simulation — je veux préparer un échange. Situation : ' : null)
    if (prefill) setDraft(prefill)
    inputRef.current?.focus()
    if (prefill) inputRef.current?.setSelectionRange(prefill.length, prefill.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages])

  const ask = (message: string) => {
    const trimmed = message.trim()
    if (!trimmed) return
    setDraft('')
    setMessages((current) => {
      const history = current.filter((item) => !item.pending).slice(-8).map(({ role, content }) => ({ role, content }))
      void getSupabase().functions.invoke('ask-tohu-proxy', { body: { message: trimmed, history } })
        .then(({ data, error }) => {
          if (error) throw error
          const answer = String(data?.answer ?? 'Je n’ai pas pu produire de réponse à partir des données disponibles.')
          setMessages((items) => items.map((item) => item.pending ? { role: 'assistant', content: answer } : item))
        })
        .catch((error: unknown) => {
          const content = error instanceof Error ? `Impossible de répondre : ${error.message}` : 'Impossible de répondre pour le moment.'
          setMessages((items) => items.map((item) => item.pending ? { role: 'assistant', content } : item))
        })
      return [...current, { role: 'user', content: trimmed }, { role: 'assistant', content: '', pending: true }]
    })
  }

  return <div className="ask-layout">
    <div className="ask-hero">
      <span className="ask-mark">T</span>
      <p className="ask-kicker">Ask Bohu</p>
      <h2>Que veux-tu comprendre<br />aujourd’hui ?</h2>
      <p>Interroge la mémoire relationnelle de ton équipe. Les réponses s’appuient uniquement sur les données auxquelles tu as accès.</p>
    </div>
    <div className="ask-thread" ref={threadRef} aria-live="polite">
      {messages.map((message, index) => message.pending
        ? <div className="message assistant pending" key={index}><span className="spinner" /></div>
        : <div className={`message ${message.role}`} key={index}>{message.content}</div>)}
    </div>
    {messages.length === 0 && <div className="ask-suggestions">
      {SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}
    </div>}
    <form className="ask-composer" onSubmit={(event) => { event.preventDefault(); ask(draft) }}>
      <textarea ref={inputRef} rows={1} placeholder="Pose une question à Tohu…" required value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button className="ask-send" aria-label="Envoyer">↑</button>
    </form>
    <p className="ask-disclaimer">Tohu peut se tromper. Les réponses sensibles doivent être vérifiées.</p>
  </div>
}
