import { describe, expect, it } from 'vitest'
import { parseBohuAnswer, parseInline } from '../askFormat'

describe('parseBohuAnswer — texte sans titre', () => {
  it('retombe sur une unique section lead avec tout le texte', () => {
    const sections = parseBohuAnswer('Ac Toulouse est calme cette semaine, rien à signaler.')
    expect(sections).toEqual([{ kind: 'lead', heading: null, facts: [], paragraphs: ['Ac Toulouse est calme cette semaine, rien à signaler.'], items: [] }])
  })
})

describe('parseBohuAnswer — titres reconnus', () => {
  it('classe Résumé / Points clés / Pourquoi / Recommandations / Sources', () => {
    const raw = [
      '### Résumé',
      'Ac Toulouse montre des signes de tension.',
      '### Points clés',
      '- Silence de 21 jours sur le contact principal',
      '- Budget 2027 en discussion',
      '### Pourquoi',
      "Deux signaux convergent vers un ralentissement.",
      '### Recommandations',
      '- Relancer Maxime cette semaine',
      '### Sources',
      '- company_signals · 2026-09-05',
    ].join('\n')
    const sections = parseBohuAnswer(raw)
    expect(sections.map((s) => s.kind)).toEqual(['lead', 'points', 'why', 'recommend', 'sources'])
    expect(sections[1]?.items).toEqual(['Silence de 21 jours sur le contact principal', 'Budget 2027 en discussion'])
    expect(sections[4]?.items).toEqual(['company_signals · 2026-09-05'])
  })

  it('un titre non reconnu retombe sur "text"', () => {
    const sections = parseBohuAnswer('### Contexte additionnel\nQuelques précisions.')
    expect(sections[0]?.kind).toBe('text')
  })

  it('ignore les lignes vides entre les paragraphes', () => {
    const sections = parseBohuAnswer('### Résumé\nPremière phrase.\n\nDeuxième phrase.')
    expect(sections[0]?.paragraphs).toEqual(['Première phrase.', 'Deuxième phrase.'])
  })
})

describe('parseBohuAnswer — faits clés (**Label :** valeur)', () => {
  it('extrait les lignes de faits en dehors des paragraphes', () => {
    const raw = ['**Compte :** Ac Toulouse', '**Niveau de risque :** élevé', 'Le reste du texte suit normalement.'].join('\n')
    const sections = parseBohuAnswer(raw)
    expect(sections[0]?.facts).toEqual([{ label: 'Compte', value: 'Ac Toulouse' }, { label: 'Niveau de risque', value: 'élevé' }])
    expect(sections[0]?.paragraphs).toEqual(['Le reste du texte suit normalement.'])
  })
})

describe('parseInline — gras **mot**', () => {
  it('segmente un texte sans gras en un seul token', () => {
    expect(parseInline('texte simple')).toEqual([{ bold: false, text: 'texte simple' }])
  })

  it('isole les segments en gras', () => {
    expect(parseInline('Silence de **21 jours** sur **Maxime Dupont**.')).toEqual([
      { bold: false, text: 'Silence de ' },
      { bold: true, text: '21 jours' },
      { bold: false, text: ' sur ' },
      { bold: true, text: 'Maxime Dupont' },
      { bold: false, text: '.' },
    ])
  })
})
