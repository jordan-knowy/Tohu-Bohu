import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ rpc }),
}))

import { handoverAccounts } from '../../account-list/service'
import { handoverPeople } from '../../person-list/service'
import type { AccountListRow } from '../../account-list/mapping'
import type { PersonListRow } from '../../person-list/mapping'

describe('passation de fiches', () => {
  beforeEach(() => rpc.mockReset())

  it('transfère les personnes via une seule opération atomique', async () => {
    rpc.mockResolvedValue({ data: { entities: 2, people: 0, skipped_people: 0 }, error: null })

    const result = await handoverPeople(
      'org-1',
      [{ id: 'contact-1' }, { id: 'contact-2' }] as PersonListRow[],
      'maxime',
    )

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('handover_fiches', {
      p_organization_id: 'org-1',
      p_entity_type: 'contact',
      p_entity_ids: ['contact-1', 'contact-2'],
      p_to_user_id: 'maxime',
      p_scope: 'entity_only',
      p_note: null,
    })
    expect(result).toEqual({ entities: 2, people: 0, skippedPeople: 0 })
  })

  it('transmet un compte et uniquement les personnes appartenant à l’expéditeur', async () => {
    rpc.mockResolvedValue({ data: { entities: 1, people: 3, skipped_people: 2 }, error: null })

    const result = await handoverAccounts(
      'org-1',
      [{ id: 'company-1' }] as AccountListRow[],
      'maxime',
      'account_and_people',
    )

    expect(rpc).toHaveBeenCalledWith('handover_fiches', {
      p_organization_id: 'org-1',
      p_entity_type: 'company',
      p_entity_ids: ['company-1'],
      p_to_user_id: 'maxime',
      p_scope: 'account_and_people',
      p_note: null,
    })
    expect(result).toEqual({ accounts: 1, people: 3, skippedPeople: 2 })
  })

  it('ne masque jamais une erreur de sécurité renvoyée par la base', async () => {
    const error = new Error('Only the current owner can hand over this contact')
    rpc.mockResolvedValue({ data: null, error })

    await expect(handoverPeople('org-1', [{ id: 'contact-1' }] as PersonListRow[], 'maxime')).rejects.toBe(error)
  })
})
