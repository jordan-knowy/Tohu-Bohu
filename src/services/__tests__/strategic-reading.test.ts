import { describe, expect, it } from 'vitest'
import { isReadingStale, mapStrategicReading, readingSufficiency } from '../strategic-reading'

describe('readingSufficiency — seuil avant toute génération (zéro hallucination)', () => {
  it('exige au moins un contact lié', () => {
    const result = readingSufficiency({ contacts: 0, signals: 5, interactions: 5, messages: 5 })
    expect(result.sufficient).toBe(false)
    expect(result.missing.join(' ')).toMatch(/contact/)
  })
  it('exige au moins 3 éléments d’historique toutes sources confondues', () => {
    const result = readingSufficiency({ contacts: 2, signals: 1, interactions: 1, messages: 0 })
    expect(result.sufficient).toBe(false)
    expect(result.missing.join(' ')).toMatch(/2 disponibles/)
  })
  it('accepte dès que contacts ≥ 1 et matière ≥ 3 (les messages comptent)', () => {
    expect(readingSufficiency({ contacts: 1, signals: 0, interactions: 0, messages: 3 }).sufficient).toBe(true)
    expect(readingSufficiency({ contacts: 1, signals: 2, interactions: 1, messages: 0 }).sufficient).toBe(true)
  })
})

describe('mapStrategicReading — mapping de la ligne persistée', () => {
  const row = {
    content: {
      synthese: 'Relation solide portée par un interlocuteur unique.',
      forces: ['Échanges réguliers', ''],
      risques: ['Couverture mono-contact'],
      prochaines_actions: ['Identifier un second contact'],
    },
    confidence: 62,
    source_counts: { contacts: 1, signals: 4, interactions: 2, messages: 18 },
    model: 'openai/gpt-4.1-mini',
    generated_at: '2026-07-16T08:00:00Z',
  }
  it('mappe le contenu, filtre les items vides et borne la confiance', () => {
    const reading = mapStrategicReading(row)
    expect(reading?.synthese).toMatch(/interlocuteur unique/)
    expect(reading?.forces).toEqual(['Échanges réguliers'])
    expect(reading?.confidence).toBe(62)
    expect(reading?.sourceCounts.messages).toBe(18)
    expect(mapStrategicReading({ ...row, confidence: 180 })?.confidence).toBe(100)
  })
  it('retourne null sans synthèse persistée — jamais un contenu fabriqué', () => {
    expect(mapStrategicReading(null)).toBeNull()
    expect(mapStrategicReading({})).toBeNull()
    expect(mapStrategicReading({ content: { synthese: '  ' } })).toBeNull()
  })
})

describe('isReadingStale — fraîcheur de la lecture', () => {
  const now = new Date('2026-07-16T12:00:00Z')
  it('est périmée au-delà de 7 jours ou sans date', () => {
    expect(isReadingStale('2026-07-01T00:00:00Z', now)).toBe(true)
    expect(isReadingStale(null, now)).toBe(true)
    expect(isReadingStale('2026-07-15T00:00:00Z', now)).toBe(false)
  })
})
