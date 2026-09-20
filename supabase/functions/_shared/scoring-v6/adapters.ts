import type { RelationalEvent, DyadIdentity, IdentityQuality, Completeness } from './foundation.ts'
import { dyadKey } from './foundation.ts'
/** Ingestion ownership is not proof of identity or participation. Missing quality stays unknown. */
export function normalizeMessage(row: Record<string, any>, identity: IdentityQuality = 'unknown'): RelationalEvent | null {
  const collaborator = row.source_owner_user_id ?? row.metadata?.user_id
  if (!row.organization_id || !row.contact_id || !collaborator || !row.id || !row.created_at) return null
  const dyad: DyadIdentity = {organizationId:row.organization_id,collaboratorUserId:collaborator,contactId:row.contact_id}
  // contact_id is only ever populated by resolve_contact_identity(), which refuses to guess on
  // ambiguity (never picks an arbitrary match on homonyms or shared inboxes) — a resolved
  // contact_id on the source row is therefore already a verified identity, not an inference.
  const identityQuality: IdentityQuality = identity !== 'unknown' ? identity : 'verified'
  // Body storage varies by provider (emails: stored since 2026-09-19 ; Slack/Google Chat:
  // analyzed_without_body_storage) — completeness here only tracks the structural fields
  // the deterministic detectors actually read (thread/direction/timing/channel).
  const completeness: Completeness = row.sent_at && row.direction && row.thread_id && row.provider ? 'complete' : 'unknown'
  return {id:`message:${row.id}:${collaborator}`,dyad,accountId:row.account_id ?? null,sourceEventId:String(row.external_message_id ?? row.id),sourceType:'communication_message',channel:String(row.provider ?? 'unknown'),
    eventTime:row.sent_at,ingestedAt:row.created_at,recordedAt:row.updated_at ?? row.created_at,effectiveFrom:row.sent_at,
    state:row.deleted_at ? 'deleted' : 'observed',internalActorId:collaborator,externalActorId:row.contact_id,participants:[collaborator,row.contact_id],ownerUserId:collaborator,
    evidenceRef:`communication_messages:${row.id}`,evidenceUnitId:`${row.provider}:${row.external_message_id ?? row.id}`,
    identityQuality,completeness,sourceVersion:'message-adapter-v1',participationObserved:true,direction:row.direction,threadId:row.thread_id}
}
export function normalizeMeeting(row: Record<string, any>, dyad: DyadIdentity): RelationalEvent | null {
  if (!row.id || !row.created_at || row.organization_id!==dyad.organizationId) return null
  return {id:`meeting:${row.id}:${dyadKey(dyad)}`,dyad,accountId:row.company_id ?? null,sourceEventId:row.id,sourceType:'meeting',channel:'meeting',eventTime:row.starts_at,ingestedAt:row.created_at,recordedAt:row.updated_at ?? row.created_at,effectiveFrom:row.starts_at,
    state:row.status==='cancelled' ? 'cancelled' : row.participation_observed===true ? 'observed':'scheduled',internalActorId:dyad.collaboratorUserId,externalActorId:dyad.contactId,participants:row.participant_ids ?? [],ownerUserId:row.owner_user_id,
    evidenceRef:`meetings:${row.id}`,evidenceUnitId:`meeting:${row.id}`,identityQuality:row.identity_quality ?? 'unknown',completeness:row.ingestion_complete===true ? 'complete':'unknown',sourceVersion:'meeting-adapter-v1',participationObserved:row.participation_observed===true}
}
/** No LIMIT 1 policy: ambiguity is a result, never an arbitrary person. */
export function resolveUniqueIdentity(ids: string[]): {contactId:string|null; quality:IdentityQuality} {
  const unique = [...new Set(ids)]
  return unique.length===1 ? {contactId:unique[0]!,quality:'verified'} : {contactId:null,quality:unique.length ? 'ambiguous':'unknown'}
}
