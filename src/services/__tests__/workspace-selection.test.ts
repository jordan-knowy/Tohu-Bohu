import { describe, expect, it } from 'vitest'
import { chooseActiveOrganization } from '../data'

describe('chooseActiveOrganization — compte partagé', () => {
  const ownMemberships = [
    { organization_id: 'personal', role: 'owner', created_at: '2026-01-01' },
    { organization_id: 'team', role: 'member', created_at: '2026-02-01' },
  ]
  const visibleMemberships = [
    { organization_id: 'personal' },
    { organization_id: 'team' },
    { organization_id: 'team' },
    { organization_id: 'team' },
  ]

  it('privilégie le workspace qui contient toute l’équipe', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships)).toBe('team')
  })

  it('respecte un workspace déjà choisi et toujours accessible', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships, 'personal')).toBe('personal')
  })

  it('ignore un ancien choix auquel le membre n’a plus accès', () => {
    expect(chooseActiveOrganization(ownMemberships, visibleMemberships, 'removed')).toBe('team')
  })
})
