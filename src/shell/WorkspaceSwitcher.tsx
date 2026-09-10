import { useEffect, useState } from 'react'
import { listMyOrganizations, setActiveOrganization, type OrganizationMembership } from '../services/data'

/** Visible uniquement si l'utilisateur appartient à plusieurs organisations
 * (ex. un membre de l'équipe Tohu invité dans le workspace d'un client).
 * Le changement d'organisation reste toujours un choix explicite — jamais
 * une bascule automatique (voir chooseActiveOrganization). */
export default function WorkspaceSwitcher({ workspaceId }: { workspaceId: string }) {
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([])

  useEffect(() => {
    listMyOrganizations().then(setOrganizations).catch(() => { /* silencieux : la topbar reste utilisable sans le sélecteur */ })
  }, [])

  if (organizations.length < 2) return null

  return (
    <select
      className="workspace-switcher"
      aria-label="Organisation active"
      value={workspaceId}
      onChange={(event) => setActiveOrganization(event.target.value)}
    >
      {organizations.map((organization) => (
        <option key={organization.organizationId} value={organization.organizationId}>{organization.name}</option>
      ))}
    </select>
  )
}
