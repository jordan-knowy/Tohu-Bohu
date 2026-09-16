// Scoring V6 — NOYAU Météo compte (6 cadrans). Fonction PURE : aucune DB, aucun
// LLM, aucune fiabilité (couche buildAccountWeatherSnapshot). Voir SCORING_V6_S0_DESIGN.md §F.
// Reproduit exactement reference_account_v6 (Météo 33). §14–24 du prompt de mission.

import type {
  AccountKEvent, AccountWeatherCoreResult, AccountWeatherInput, DialContribution,
  DialId, DialResult, MarkerRegistry, ScoringParams,
} from './types'
import { relationTypeStatus } from './registry-v6'

const DIALS: DialId[] = ['d_satisfaction', 'd_confiance_recip', 'd_couverture', 'd_equilibre', 'd_ancrage', 'd_dynamique']
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function repMult(occurrences: number, params: ScoringParams): number {
  if (occurrences >= 4) return params.repetition.occ4plus
  if (occurrences >= 2) return params.repetition.occ2to3
  return params.repetition.occ1
}

/** Points signés d'un K selon le mode. PALIER : palier ; SPEC : ptsSpec historique. */
function kPoints(markerId: string, params: ScoringParams, registry: MarkerRegistry): number {
  const entry = registry.markers[markerId]
  if (!entry) return 0
  if (params.mode === 'spec') return entry.ptsSpec ?? 0
  const t = params.tiers[entry.tier]
  // K : signe négatif (sauf K09 neutre → 0)
  return entry.sign < 0 ? t.neg : entry.sign > 0 ? t.pos : 0
}

/** Interpolation linéaire à 3 ancres (x décroissant ou croissant), plateaux aux extrêmes. */
function interp3(x: number, xa: number, va: number, xb: number, vb: number, xc: number, vc: number): number {
  // xa/xb/xc dans l'ordre décroissant de « meilleur » → borne haute d'abord
  if (xa < xc) { // x croissant vers le pire (silence : ratio)
    if (x <= xa) return va
    if (x <= xb) return va + (x - xa) / (xb - xa) * (vb - va)
    if (x <= xc) return vb + (x - xb) / (xc - xb) * (vc - vb)
    return vc
  }
  // x décroissant vers le pire (pente : delta)
  if (x >= xa) return va
  if (x >= xb) return vb + (x - xb) / (xa - xb) * (va - vb)
  if (x >= xc) return vc + (x - xc) / (xb - xc) * (vb - vc)
  return vc
}

function wavg(items: Array<{ authority: number }>, valueFn: (i: any) => number): number | null {
  const wsum = items.reduce((s, i) => s + i.authority, 0)
  if (wsum <= 0) return null
  return items.reduce((s, i) => s + i.authority * valueFn(i), 0) / wsum
}

/** Somme des modificateurs K (non résolus) par cadran, + flags de plafond. */
function kModifiers(kEvents: AccountKEvent[], params: ScoringParams, registry: MarkerRegistry) {
  const byDial = new Map<DialId, DialContribution[]>()
  let capK06 = false
  let capK01 = false
  for (const ke of kEvents) {
    if (ke.resolvedAt) continue // K résolu : effet cessé (marker_event conservé ailleurs)
    const entry = registry.markers[ke.markerId]
    if (!entry || entry.scope !== 'account' || !entry.dial) continue
    if (ke.markerId === 'K06') capK06 = true
    if (ke.markerId === 'K01' && (ke.openMonths ?? 0) > params.dynamics.k01CapMonths) capK01 = true
    const pts = kPoints(ke.markerId, params, registry)
    const rep = repMult(ke.occurrences ?? 1, params)
    const contribution = pts * rep
    const list = byDial.get(entry.dial) ?? []
    list.push({
      markerId: ke.markerId, pointsEffectifs: pts, occurrences: ke.occurrences ?? 1, repetitionMultiplier: rep, contribution,
      evidenceRef: ke.evidenceRef || null, observedAt: ke.observedAt || null,
      evidenceText: ke.evidenceText ?? null, isVerbatim: ke.isVerbatim ?? false,
    })
    byDial.set(entry.dial, list)
  }
  return { byDial, capK06, capK01 }
}

export function calculateAccountWeatherCore(
  input: AccountWeatherInput,
  params: ScoringParams,
  registry: MarkerRegistry,
): AccountWeatherCoreResult {
  const km = kModifiers(input.kEvents, params, registry)
  const mod = (d: DialId) => (km.byDial.get(d) ?? [])
  const modSum = (d: DialId) => mod(d).reduce((s, c) => s + c.contribution, 0)

  const dials = {} as Record<DialId, DialResult>
  const weights = params.dialWeights[input.relationType] ?? params.dialWeights['Client/Prospect']!

  // ── Satisfaction : moyenne pondérée autorité des S, + K03/K06/K07, plafond K06 ──
  {
    const base = wavg(input.activeDyads, (d) => d.satisfaction)
    let value: number | null = null
    let cappedBy: string | null = null
    if (base !== null) {
      value = clamp(Math.round(base + modSum('d_satisfaction')), 0, 100)
      if (km.capK06) { value = Math.min(value, params.dynamics.k06Cap); cappedBy = 'K06' }
    }
    dials.d_satisfaction = mkDial('d_satisfaction', base, value, weights.d_satisfaction, cappedBy, mod('d_satisfaction'))
  }
  // ── Confiance & réciprocité : moyenne pondérée de (C+R)/2, aucun K ──
  {
    const base = wavg(input.activeDyads, (d) => (d.confiance + d.reciprocite) / 2)
    const value = base === null ? null : clamp(Math.round(base), 0, 100)
    dials.d_confiance_recip = mkDial('d_confiance_recip', base, value, weights.d_confiance_recip, null, [])
  }
  // ── Couverture : 100 × Σautorité(couverts)/Σautorité(cibles) ; malus RCS ; plafond 40 ──
  {
    const targets = input.coverage.targets
    const sumTargets = targets.reduce((s, t) => s + t.authority, 0)
    let base: number | null = null
    let value: number | null = null
    let cappedBy: string | null = null
    if (sumTargets > 0) {
      // Niveau relationnel réel 0..1 si fourni (0=aucune interaction … 1=relation active/récente) ;
      // rétro-compatible : sans relationalLevel, on retombe sur le binaire covered (0 ou 1).
      const sumCovered = targets.reduce((s, t) => s + t.authority * (t.relationalLevel ?? (t.covered ? 1 : 0)), 0)
      base = 100 * sumCovered / sumTargets
      let v = base + (input.coverage.rcsChangeUnreflected ? params.coverage.malusRcsUnreflected : 0)
      const deciderWithoutDyad = targets.some((t) => t.isDecider && !t.covered)
      if (deciderWithoutDyad) { v = Math.min(v, params.coverage.capDeciderNoDyad); cappedBy = 'décideur sans dyade' }
      value = clamp(Math.round(v), 0, 100)
    }
    dials.d_couverture = mkDial('d_couverture', base, value, weights.d_couverture, cappedBy, [])
  }
  // ── Équilibre : 100 × (1 − HHI) ; un seul interlocuteur → 0 ──
  {
    const shares = input.equilibreShares
    let value: number | null = null
    let base: number | null = null
    if (shares.length === 0) { /* null */ }
    else if (shares.length === 1) { base = 0; value = 0 }
    else {
      const total = shares.reduce((s, x) => s + x, 0)
      if (total > 0) {
        const hhi = shares.reduce((s, x) => s + (x / total) ** 2, 0)
        base = 100 * (1 - hhi)
        value = clamp(Math.round(base), 0, 100)
      }
    }
    dials.d_equilibre = mkDial('d_equilibre', base, value, weights.d_equilibre, null, [])
  }
  // ── Ancrage : barème porteurs + K05/K08 ──
  {
    const c = input.carriers
    const base = c <= 0 ? params.anchoring[0] : c === 1 ? params.anchoring[1] : c === 2 ? params.anchoring[2] : params.anchoring.threePlus
    const value = clamp(Math.round(base + modSum('d_ancrage')), 0, 100)
    dials.d_ancrage = mkDial('d_ancrage', base, value, weights.d_ancrage, null, mod('d_ancrage'))
  }
  // ── Dynamique : 0.30 pente + 0.40 silence + 0.30 solde, + K01/K02/K04, plafond K01>12mo ──
  {
    const dy = input.dynamics
    const a = params.dynamics
    const pente = interp3(dy.delta30OtherDials, a.penteAnchors.deltaHigh, a.penteAnchors.vHigh, a.penteAnchors.deltaMid, a.penteAnchors.vMid, a.penteAnchors.deltaLow, a.penteAnchors.vLow)
    const ratio = dy.cadenceMedian > 0 ? dy.daysSinceLast / dy.cadenceMedian : (dy.daysSinceLast > 0 ? 99 : 0)
    const silence = interp3(ratio, a.silenceAnchors.r1, a.silenceAnchors.v1, a.silenceAnchors.r2, a.silenceAnchors.v2, a.silenceAnchors.r3, a.silenceAnchors.v3)
    const solde = clamp(a.solde.base + a.solde.step * (dy.engagementsHeld - dy.engagementsSlipped), 0, 100)
    const base = a.weights.pente * pente + a.weights.silence * silence + a.weights.solde * solde
    let cappedBy: string | null = null
    let v = base + modSum('d_dynamique')
    if (km.capK01) { v = Math.min(v, params.dynamics.k01Cap); cappedBy = 'K01>12mois' }
    const value = clamp(Math.round(v), 0, 100)
    const d = mkDial('d_dynamique', Math.round(base), value, weights.d_dynamique, cappedBy, mod('d_dynamique'))
    d.note = `pente=${Math.round(pente)} · silence=${Math.round(silence)} · solde=${Math.round(solde)}`
    // Δ 30j réel (moyenne des 5 autres cadrans) — déjà utilisé dans le calcul de la pente ;
    // exposé tel quel pour l'UI (jamais un texte technique de debug dans la carte).
    d.trendDelta30d = Math.round(dy.delta30OtherDials)
    dials.d_dynamique = d
  }

  // ── Météo : Σ cadran × poids, redistribution au prorata des cadrans null ──
  const calculable = DIALS.filter((d) => dials[d].value !== null)
  let score: number | null = null
  let weakestDial: DialId | null = null
  if (calculable.length > 0) {
    const wsum = calculable.reduce((s, d) => s + dials[d].weight, 0)
    for (const d of DIALS) dials[d].effectiveWeight = dials[d].value === null ? 0 : dials[d].weight / wsum
    if (calculable.length < DIALS.length) for (const d of calculable) dials[d].note = (dials[d].note ? dials[d].note + ' · ' : '') + 'poids redistribué'
    score = Math.round(calculable.reduce((s, d) => s + (dials[d].value as number) * dials[d].effectiveWeight, 0))
    weakestDial = calculable.reduce((min, d) => (dials[d].value as number) < (dials[min].value as number) ? d : min, calculable[0]!)
  }

  return {
    score,
    dials,
    weakestDial,
    relationType: input.relationType,
    relationTypeStatus: relationTypeStatus(input.relationType),
    paramsVersion: params.version,
    registryVersion: registry.version,
    mode: params.mode,
  }
}

function mkDial(dial: DialId, base: number | null, value: number | null, weight: number, cappedBy: string | null, modifiers: DialContribution[]): DialResult {
  return { dial, base, value, weight, effectiveWeight: 0, cappedBy, modifiers }
}
