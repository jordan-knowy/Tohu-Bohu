// Scoring V6 — S7 : rejeu temporel. Le pas est le MOIS, la courbe est un ESCALIER
// (aucune interpolation). Pour T : score(T) utilise le même moteur + mêmes versions
// + seulement les marker_events observed_at ≤ T. § S7 du prompt de mission.

import { buildDyadScoreSnapshot } from './snapshots'
import type { DyadSnapshotInput } from './snapshots'

/** 1er jour (UTC) des `count` derniers mois civils jusqu'à `end` (inclus), ordre chronologique. */
export function monthlySteps(end: Date, count: number): string[] {
  const steps: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    steps.push(d.toISOString())
  }
  return steps
}

export interface ReplayPoint { at: string; snapshotMonth: string; score: number | null; verdictAllowed: boolean }

/** Rejoue une dyade mois par mois. Aucune interpolation : chaque marche est un
 *  calcul réel à sa date, à partir des marqueurs observés ≤ à ce mois. */
export function replayDyadMonthly(base: Omit<DyadSnapshotInput, 'at'>, months: string[]): ReplayPoint[] {
  return months.map((at) => {
    const snap = buildDyadScoreSnapshot({ ...base, at })
    return { at, snapshotMonth: at.slice(0, 10), score: snap.score, verdictAllowed: snap.verdictAllowed }
  })
}

/** Delta 30 j = score(T) − score(T − 30 j). null si l'une des deux bornes est null. */
export function computeDelta30(base: Omit<DyadSnapshotInput, 'at'>, at: string): number | null {
  const now = buildDyadScoreSnapshot({ ...base, at })
  const prev = buildDyadScoreSnapshot({ ...base, at: new Date(new Date(at).getTime() - 30 * 86_400_000).toISOString() })
  if (now.score === null || prev.score === null) return null
  return now.score - prev.score
}
