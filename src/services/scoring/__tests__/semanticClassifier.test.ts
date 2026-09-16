import { describe, expect, it } from 'vitest'
import { buildClassifierPrompt, parseClassifierResponse, SEMANTIC_MARKER_IDS } from '../semanticClassifier'
import type { ClassifierInput } from '../semanticClassifier'

const input = (o: Partial<ClassifierInput> = {}): ClassifierInput => ({
  extractId: 'm1', extractText: 'Merci beaucoup, travail remarquable !', hasVerbatim: false,
  observedAt: '2026-09-01T00:00:00Z', contactId: 'c1', source: 'person_key_moment', ...o,
})

describe('classificateur sémantique — registre fermé', () => {
  it('le prompt ne propose que les marqueurs du registre', () => {
    const p = buildClassifierPrompt(input())
    for (const id of SEMANTIC_MARKER_IDS) expect(p).toContain(id)
    expect(p).toContain('NO_MARKER')
    expect(p).toContain('REGISTRE FERMÉ')
  })
  it('un marqueur hors registre (S99) est rejeté', () => {
    expect(parseClassifierResponse(input(), { marker_id: 'S99', confidence: 0.99 })).toBeNull()
  })
  it('NO_MARKER → aucun draft', () => {
    expect(parseClassifierResponse(input(), { marker_id: 'NO_MARKER' })).toBeNull()
  })
  it('un marqueur valide + confiance haute → accepté (scoré)', () => {
    const d = parseClassifierResponse(input(), { marker_id: 'S08', confidence: 0.9, rationale: 'éloge' })!
    expect(d.markerId).toBe('S08'); expect(d.sense).toBe(1); expect(d.isCandidate).toBe(false)
  })
})

describe('garde-fous — verbatim, confiance, date', () => {
  it('S07 sans verbatim → candidate (jamais scoré)', () => {
    const d = parseClassifierResponse(input({ hasVerbatim: false }), { marker_id: 'S07', confidence: 0.95 })!
    expect(d.markerId).toBe('S07'); expect(d.isCandidate).toBe(true)
  })
  it('S07 avec verbatim + confiance haute → accepté', () => {
    const d = parseClassifierResponse(input({ hasVerbatim: true }), { marker_id: 'S07', confidence: 0.95 })!
    expect(d.isCandidate).toBe(false)
  })
  it('confiance faible → candidate', () => {
    expect(parseClassifierResponse(input(), { marker_id: 'S08', confidence: 0.4 })!.isCandidate).toBe(true)
  })
  it('sans date observée → aucun marqueur', () => {
    expect(parseClassifierResponse(input({ observedAt: null }), { marker_id: 'S08', confidence: 0.9 })).toBeNull()
  })
  it('le sens vient du registre, pas du LLM', () => {
    expect(parseClassifierResponse(input(), { marker_id: 'S03', sense: 1, confidence: 0.9 })!.sense).toBe(-1)
  })
})
