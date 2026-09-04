import { useEffect, useState } from 'react'

/** Signal partagé, hors React, pour qu'une fiche (Personne, Compte…) remplace
 *  le titre générique du topbar par « ← Retour + nom de la fiche », sans faire
 *  remonter cet état dans un contexte React global. Voir bohuBarSignal.ts pour
 *  le même principe. */
export type TopbarHeaderOverride = { backTo: string; backLabel: string; title: string } | null
type Listener = (value: TopbarHeaderOverride) => void
let current: TopbarHeaderOverride = null
const listeners = new Set<Listener>()

export function setTopbarHeader(value: TopbarHeaderOverride): void {
  current = value
  listeners.forEach((listener) => listener(current))
}

export function useTopbarHeader(): TopbarHeaderOverride {
  const [value, setValue] = useState(current)
  useEffect(() => {
    const listener: Listener = (next) => setValue(next)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return value
}
