import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SCOPES = [
  { value: 'organisation', label: 'Mon organisation' },
  { value: 'comptes', label: 'Mes comptes' },
  { value: 'contacts', label: 'Mes contacts' },
]
const ROTATION = [
  { c: 'Commerce', col: '#6E50C8', ex: 'Où concentrer mes efforts relationnels cette semaine ?' },
  { c: 'Produit', col: '#2896A8', ex: 'Les remontées produit les plus importantes sur 6 mois ?' },
  { c: 'CSM', col: '#2EA86A', ex: 'Mes 3 plus grandes alertes de santé relationnelle ?' },
  { c: 'Operations', col: '#C97A20', ex: 'Quelles relations partent si un collègue quitte la boîte ?' },
]

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
const SendArrow = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** Barre Bohu persistante en bas de page — permet d'interroger Bohu depuis n'importe où
 *  dans l'app. Redirige vers /app/ask en envoyant la question (state.ask). */
export default function BohuBar() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [scopeIndex, setScopeIndex] = useState(0)
  const [rotIndex, setRotIndex] = useState(0)
  const [rotFade, setRotFade] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused || draft) return
    const id = setInterval(() => {
      setRotFade(true)
      setTimeout(() => { setRotIndex((index) => (index + 1) % ROTATION.length); setRotFade(false) }, 420)
    }, 3000)
    return () => clearInterval(id)
  }, [focused, draft])

  const submit = (message: string) => {
    const trimmed = message.trim()
    if (!trimmed) return
    setDraft('')
    navigate('/app/ask', { state: { ask: trimmed, scope: SCOPES[scopeIndex]?.value } })
  }

  const rot = ROTATION[rotIndex]!
  const scopeLabel = SCOPES[scopeIndex]?.label ?? 'Mon organisation'

  return <div className="bohubar-wrap">
    <form className="bohubar" onSubmit={(event) => { event.preventDefault(); submit(draft) }}>
      <span className="bohubar-mk">{BohuMark}</span>
      <button type="button" className="bohubar-scope" onClick={() => setScopeIndex((index) => (index + 1) % SCOPES.length)} aria-label={`Périmètre : ${scopeLabel}. Cliquer pour changer.`}>
        <span className="dot" aria-hidden="true" />{scopeLabel}<span className="caret" aria-hidden="true">▾</span>
      </button>
      <span className="bohubar-inwrap">
        <input type="text" value={draft} aria-label="Poser une question à Bohu"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)} />
        <span className={`bohubar-ghost${draft ? ' is-hidden' : ''}${rotFade ? ' is-fading' : ''}`} aria-hidden="true">
          {focused
            ? <span className="bohubar-ex">Demande à Bohu…</span>
            : <>
                <span className="bohubar-cat"><span className="cd" style={{ background: rot.col }} />{rot.c}</span>
                <span className="bohubar-ex">{rot.ex}</span>
              </>}
        </span>
      </span>
      <button type="submit" className="bohubar-send" aria-label="Envoyer">{SendArrow}</button>
    </form>
  </div>
}
