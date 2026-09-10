import { describe, expect, it } from 'vitest'
import { chooseActiveOrganization } from '../data'

describe('chooseActiveOrganization — chacun garde son organisation par défaut', () => {
  // Cas réel ayant motivé ce test : jordan@tohu.co est owner de son
  // organisation « Tohu » (1 membre) et vient d'être invité comme member
  // dans l'organisation d'un client, « Webfityou » (2 membres). Rejoindre
  // cette équipe ne doit jamais faire basculer son workspace par défaut.
  const ownMemberships = [
    { organization_id: 'tohu', role: 'owner', created_at: '2026-09-09' },
    { organization_id: 'webfityou', role: 'member', created_at: '2026-09-10' },
  ]
  const visibleMemberships = [
    { organization_id: 'tohu' },
    { organization_id: 'webfityou' },
    { organization_id: 'webfityou' },
  ]

  it('reste dans son organisation propriétaire même si une autre organisation compte plus de membres', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships)).toBe('tohu')
  })

  it('respecte un workspace déjà choisi et toujours accessible, même différent de son organisation propriétaire', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships, 'webfityou')).toBe('webfityou')
  })

  it('ignore un ancien choix auquel le membre n’a plus accès et retombe sur son organisation propriétaire', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships, 'removed')).toBe('tohu')
  })

  it('choisit la plus ancienne organisation propriétaire s’il en possède plusieurs', () => {
    const multiOwned = [
      { organization_id: 'second', role: 'owner', created_at: '2026-02-01' },
      { organization_id: 'first', role: 'owner', created_at: '2026-01-01' },
    ]
    expect(chooseActiveOrganization(multiOwned, [])).toBe('first')
  })

  it('retombe sur l’organisation la mieux peuplée en filet de sécurité si l’utilisateur n’est owner nulle part', () => {
    const onlyMember = [
      { organization_id: 'small', role: 'member', created_at: '2026-01-01' },
      { organization_id: 'big', role: 'member', created_at: '2026-02-01' },
    ]
    const visible = [
      { organization_id: 'small' },
      { organization_id: 'big' },
      { organization_id: 'big' },
    ]
    expect(chooseActiveOrganization(onlyMember, visible)).toBe('big')
  })
})
