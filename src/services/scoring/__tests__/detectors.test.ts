import { describe, expect, it } from 'vitest'
import {
  computeDyadBaseline, detectA01, detectA02, detectE05Candidate, detectR01, detectR02, detectS04,
} from '../detectors'
import type { DyadBaseline, DyadMeeting, DyadMessage } from '../detectors'

const NOW = new Date('2026-09-01T00:00:00Z').getTime()
const DAY = 86_400_000
const iso = (daysAgo: number, hoursAgo = 0) => new Date(NOW - daysAgo * DAY - hoursAgo * 3_600_000).toISOString()
let n = 0
const msg = (threadId: string, direction: 'inbound' | 'outbound', sentAt: string, subject = 'Sujet'): DyadMessage =>
  ({ id: `m-${n++}`, threadId, direction, sentAt, subject })
const meet = (startsAt: string, occurred = true, contactParticipated = true): DyadMeeting =>
  ({ id: `mt-${n++}`, startsAt, occurred, contactParticipated })

describe('P4 — baseline dyade', () => {
  it('≥ 8 épisodes → suffisant, fiabilité non plafonnée', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg('t1', i % 2 ? 'inbound' : 'outbound', iso(30 + i)))
    const b = computeDyadBaseline(messages, [], NOW)
    expect(b.episodes).toBe(10)
    expect(b.sufficient).toBe(true)
    expect(b.reliabilityCap).toBe(1)
    expect(b.cadenceMedianDays).not.toBeNull()
  })
  it('< 8 épisodes → insuffisant, fiabilité ≤ 0.50 (P4)', () => {
    const b = computeDyadBaseline([msg('t', 'outbound', iso(10)), msg('t', 'inbound', iso(9))], [], NOW)
    expect(b.sufficient).toBe(false)
    expect(b.reliabilityCap).toBe(0.5)
  })
  it('calcule la latence de réponse du contact (outbound → inbound)', () => {
    const messages = [msg('t', 'outbound', iso(10)), msg('t', 'inbound', iso(10, -24))] // +24h
    const b = computeDyadBaseline(messages, [], NOW)
    expect(b.contactResponseMedianHours).toBeCloseTo(24, 0)
  })
})

describe('S04 — relances ≥2× sans réponse', () => {
  it('2 outbound sur jours distincts, 0 inbound → marqueur S04 (−1)', () => {
    const d = detectS04([msg('t1', 'outbound', iso(10), 'Dossier'), msg('t1', 'outbound', iso(5), 'Dossier')])
    expect(d).toHaveLength(1)
    expect(d[0]!.markerId).toBe('S04')
    expect(d[0]!.sense).toBe(-1)
    expect(d[0]!.status).toBe('accepted')
    expect(d[0]!.measure.outboundCount).toBe(2)
  })
  it('une réponse intercalée → pas de S04', () => {
    expect(detectS04([msg('t', 'outbound', iso(10)), msg('t', 'inbound', iso(8)), msg('t', 'outbound', iso(5))])).toHaveLength(0)
  })
  it('2 relances le même jour → pas de S04 (pas vraiment espacées)', () => {
    expect(detectS04([msg('t', 'outbound', '2026-08-27T09:00:00Z'), msg('t', 'outbound', '2026-08-27T15:00:00Z')])).toHaveLength(0)
  })
})

describe('R01 — latence vs baseline (jamais un seuil absolu)', () => {
  const base = (h: number | null): DyadBaseline => ({
    episodes: 12, sufficient: true, reliabilityCap: 1, cadenceMedianDays: 7,
    contactResponseMedianHours: h, ourResponseMedianHours: 20, avgThreadDepth: 3, channels: ['email'], windowDays: 182,
  })
  it('réponse nettement plus lente que la baseline → −1', () => {
    const recent = [msg('r', 'outbound', iso(10)), msg('r', 'inbound', iso(10, -72)), msg('r2', 'outbound', iso(8)), msg('r2', 'inbound', iso(8, -72))]
    const d = detectR01(base(24), recent, NOW)
    expect(d[0]!.markerId).toBe('R01')
    expect(d[0]!.sense).toBe(-1)
  })
  it('réponse nettement plus rapide → +1', () => {
    const recent = [msg('r', 'outbound', iso(10)), msg('r', 'inbound', iso(10, -6)), msg('r2', 'outbound', iso(8)), msg('r2', 'inbound', iso(8, -6))]
    expect(detectR01(base(72), recent, NOW)[0]!.sense).toBe(1)
  })
  it('baseline insuffisante → aucun marqueur (P4)', () => {
    expect(detectR01({ ...base(24), sufficient: false }, [], NOW)).toHaveLength(0)
  })
})

describe('R02 — initiation qualifiée = candidate (substance non mesurable)', () => {
  it('fil initié par le contact → candidate +1', () => {
    const d = detectR02([msg('t', 'inbound', iso(10)), msg('t', 'outbound', iso(9))], NOW)
    expect(d[0]!.markerId).toBe('R02')
    expect(d[0]!.status).toBe('candidate')
  })
})

describe('A01 / A02 — ancrage déterministe', () => {
  it('A01 : 2 canaux → +1 ; 1 canal → −1', () => {
    expect(detectA01([msg('t', 'outbound', iso(10))], [meet(iso(9))], NOW)[0]!.sense).toBe(1)
    expect(detectA01([msg('t', 'outbound', iso(10))], [], NOW)[0]!.sense).toBe(-1)
  })
  it('A02 : ≥3 trimestres actifs → +1 ; ≤1 → −1', () => {
    const spread = [msg('a', 'outbound', iso(10)), msg('b', 'outbound', iso(100)), msg('c', 'outbound', iso(190))]
    expect(detectA02(spread, [], NOW)[0]!.sense).toBe(1)
    expect(detectA02([msg('a', 'outbound', iso(5))], [], NOW)[0]!.sense).toBe(-1)
  })
})

describe('E05 — candidate (accept/decline non capté)', () => {
  it('réunion tenue avec le contact → candidate +1, non auto-scoré', () => {
    const d = detectE05Candidate([meet(iso(10), true, true)])
    expect(d[0]!.markerId).toBe('E05')
    expect(d[0]!.status).toBe('candidate')
    expect(d[0]!.sense).toBe(1)
  })
  it('aucune réunion tenue → aucun candidat', () => {
    expect(detectE05Candidate([meet(iso(10), false, false)])).toHaveLength(0)
  })
})
