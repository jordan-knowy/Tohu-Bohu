import type { HomePriorityAction } from './types'

/**
 * Patron partagé entre le panneau « Éléments en suspens » et le ticker
 * « Highlights du jour » — les deux tirent le même poids visuel et la même
 * action suggérée d'ici, pour qu'un même fait se reconnaisse d'un bloc à
 * l'autre plutôt que d'apparaître comme deux informations différentes.
 * Module pur (pas d'accès réseau), même esprit que priority.ts.
 */

export type PriorityWeight = 'high' | 'medium' | 'low'

/** Palier de poids visuel — même barème 0-100 que priority.ts::priorityOf(). */
export function weightOf(priority: number): PriorityWeight {
  if (priority >= 70) return 'high'
  if (priority >= 40) return 'medium'
  return 'low'
}

export type SuggestedAction =
  | { kind: 'add-person'; label: string }
  | { kind: 'open-account'; label: string }
  | { kind: 'open-person'; label: string }

/**
 * Action suggérée par type d'action — déterministe, aucun appel IA. Source
 * unique pour le libellé affiché (rendu) et le comportement du clic
 * (bindActions), afin que les deux ne puissent jamais diverger.
 */
export function suggestedActionFor(action: HomePriorityAction): SuggestedAction | null {
  switch (action.type) {
    case 'couverture':
      return action.accountId ? { kind: 'add-person', label: 'Identifier un second contact' } : null
    case 'relance':
    case 'risque':
    case 'mouvement':
    case 'opportunite':
      return action.accountId
        ? { kind: 'open-account', label: 'Ouvrir le compte' }
        : action.personId ? { kind: 'open-person', label: 'Ouvrir la fiche' } : null
    case 'engagement':
    case 'validation':
      return action.personId
        ? { kind: 'open-person', label: 'Ouvrir la fiche' }
        : action.accountId ? { kind: 'open-account', label: 'Ouvrir le compte' } : null
    default:
      return null
  }
}
