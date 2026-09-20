import { describe, it, expect } from 'vitest'
import { extractAuthoredText, MAX_CLASSIFIABLE_CHARS } from '../../../../supabase/functions/_shared/scoring-v6/emailText.ts'

describe('extractAuthoredText', () => {
  it('keeps what the sender wrote and drops the signature block quoted below', () => {
    const body = 'Merci pour ton retour et pour l’analyse, j’ai pris le temps de regarder le document.\nBien à toi\n*From:* webfityou\n*Sent:* Thursday\nAncien message de NOTRE côté'
    const text = extractAuthoredText(body)
    expect(text).toContain('Merci pour ton retour')
    expect(text).not.toContain('NOTRE côté')
  })
  it.each([
    'Le jeu. 17 sept. 2026 à 11:32, Jordan <j@x.io> a écrit :',
    'On Thu, Sep 17, 2026 at 11:32 AM Jordan <j@x.io> wrote:',
    '-----Original Message-----',
    'De : Jordan\nEnvoyé : jeudi',
    '> ligne citée',
  ])('cuts the quoted history at "%s"', (marker) => {
    const text = extractAuthoredText(`Voici ma réponse détaillée sur le devis.\n${marker}\nPhrase écrite par notre côté`)
    expect(text).toBe('Voici ma réponse détaillée sur le devis.')
  })
  it('returns empty when nothing of the sender remains (pure forward / too short)', () => {
    expect(extractAuthoredText('De : Jordan\nun message transféré')).toBe('')
    expect(extractAuthoredText('ok merci')).toBe('')
    expect(extractAuthoredText(null)).toBe('')
  })
  it('bounds the length sent to the classifier', () => {
    expect(extractAuthoredText('a'.repeat(10_000)).length).toBe(MAX_CLASSIFIABLE_CHARS)
  })
})
