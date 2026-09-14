import { useEffect } from 'react'

/** Événement hors React, sur le même principe que topbarHeaderSignal / bohuBarSignal :
 *  n'importe quelle page (Home, fiche Compte, vues legacy en JS pur…) peut demander
 *  l'ouverture du panneau « Ajouter » unique porté par AppShell, sans faire remonter
 *  cet état dans un contexte React global. AppShell est le seul abonné — monté une
 *  fois pour toute la session — donc un simple événement (pas un état rejoué au
 *  montage) suffit : rien à « rattraper » si personne n'écoute encore. */
export type AddPanelRequest = {
  tab?: 'compte' | 'personne'
  filterAccountId?: string | null
  filterAccountName?: string | null
}
type Listener = (request: AddPanelRequest) => void
const listeners = new Set<Listener>()

export function requestAddPanel(request: AddPanelRequest = {}): void {
  listeners.forEach((listener) => listener(request))
}

export function useAddPanelRequests(onRequest: (request: AddPanelRequest) => void): void {
  useEffect(() => {
    listeners.add(onRequest)
    return () => { listeners.delete(onRequest) }
  }, [onRequest])
}
