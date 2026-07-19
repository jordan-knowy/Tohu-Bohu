import { describe, expect, it } from 'vitest'
import { classifyEmailAutomation } from '../../../supabase/functions/sync-email-analysis/email-classification'

describe('classifyEmailAutomation', () => {
  it.each([
    'no-reply@service.com',
    'notifications@linkedin.com',
    'newsletter@media.fr',
    'support@outil.io',
    'info@entreprise.fr',
  ])('écarte les adresses techniques ou génériques : %s', (email) => {
    expect(classifyEmailAutomation({ email }).automated).toBe(true)
  })

  it('écarte une liste de diffusion identifiée par ses en-têtes', () => {
    const result = classifyEmailAutomation({
      email: 'alice@media.fr',
      name: 'Alice',
      subject: 'Les actualités de la semaine',
      headers: {
        'List-Unsubscribe': '<https://media.fr/unsubscribe>',
        'List-Id': 'weekly.media.fr',
      },
    })

    expect(result.automated).toBe(true)
    expect(result.reasons).toContain('en-têtes de diffusion')
  })

  it('écarte une campagne détectée dans le contenu même avec une adresse crédible', () => {
    const result = classifyEmailAutomation({
      email: 'camille@marque.fr',
      name: 'Équipe marketing',
      subject: 'Notre newsletter mensuelle',
      body: 'Voir cet email dans votre navigateur. Gérer vos préférences ou se désabonner.',
    })

    expect(result.automated).toBe(true)
  })

  it('conserve un véritable échange professionnel', () => {
    const result = classifyEmailAutomation({
      email: 'claire.martin@acme.fr',
      name: 'Claire Martin',
      subject: 'Re: Proposition commerciale',
      body: 'Bonjour Jordan, je suis disponible mardi à 14 h pour reprendre la proposition. Bien à vous, Claire.',
    })

    expect(result).toEqual({ automated: false, reasons: [] })
  })

  it('ne bloque pas un humain uniquement parce que son message évoque une newsletter', () => {
    const result = classifyEmailAutomation({
      email: 'paul.durand@acme.fr',
      name: 'Paul Durand',
      subject: 'Re: votre newsletter',
      body: 'Merci pour ton retour. Je te confirme notre rendez-vous de jeudi.',
    })

    expect(result.automated).toBe(false)
  })
})
