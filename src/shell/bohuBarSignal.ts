import { useEffect, useState } from 'react'

/** Signal partagé, hors React, pour que n'importe quelle page (passation,
 *  sélection…) puisse demander à la barre Bohu persistante (BohuBar) de se
 *  réduire au logo le temps qu'une barre d'action bas-de-page prenne sa place,
 *  sans avoir à faire remonter cet état dans un contexte React global. */
type Listener = (shrunk: boolean) => void
let current = false
const listeners = new Set<Listener>()

export function setBohuBarShrunk(shrunk: boolean): void {
  if (current === shrunk) return
  current = shrunk
  listeners.forEach((listener) => listener(current))
}

export function useBohuBarShrunk(): boolean {
  const [shrunk, setShrunk] = useState(current)
  useEffect(() => {
    const listener: Listener = (value) => setShrunk(value)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return shrunk
}
