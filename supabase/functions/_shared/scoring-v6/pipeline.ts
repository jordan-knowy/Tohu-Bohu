import { buildRelationalState, dyadKey, revisionsAt, type FoundationInput, type RelationalEvent, type MarkerRevision } from './foundation.ts'
import { runDeterministicDetectors, type DyadBaseline } from './detectors.ts'
export function detectNormalizedEvents(events: RelationalEvent[], dyad: FoundationInput['dyad'], at: string): {markers:MarkerRevision[];errors:string[];baseline:DyadBaseline;available:RelationalEvent[]} {
  const errors:string[]=[], now=Date.parse(at), key=dyadKey(dyad)
  const available=revisionsAt(events.filter(e=>dyadKey(e.dyad)===key),now,errors).filter(e=>
    e.state==='observed' && e.identityQuality==='verified' && e.completeness==='complete' && e.participationObserved &&
    Date.parse(e.eventTime)<=now && Date.parse(e.ingestedAt)<=now && Date.parse(e.effectiveFrom)<=now && (!e.effectiveUntil || Date.parse(e.effectiveUntil)>now))
  const messages=available.filter(e=>e.direction && e.threadId).map(e=>({id:e.id,threadId:e.threadId!,sentAt:e.eventTime,direction:e.direction!}))
  const meetings=available.filter(e=>e.channel==='meeting').map(e=>({id:e.id,startsAt:e.eventTime,occurred:true,contactParticipated:true,state:'observed' as const}))
  const {baseline,drafts}=runDeterministicDetectors(messages,meetings,now)
  return {errors,baseline,available,markers:drafts.map(d=>{
    // Each detector reports the minimal real events that actually ground its
    // observation (d.supportEventIds) — never the entire available pool, which
    // would make every non-thread-scoped marker share evidence with everything
    // else and collapse into one connected component (defeating the
    // independent-evidence-count admissibility check).
    const ids=new Set(d.supportEventIds)
    const supports=available.filter(e=>ids.has(e.id) && Date.parse(e.eventTime)<=Date.parse(d.observedAt)).map(e=>e.id).sort()
    // d.evidenceText est la description factuelle déjà calculée par le détecteur
    // (ex. « 3 relances sans réponse sur «sujet» (5 j) ») — jusqu'ici jetée à la
    // persistance, ce qui vidait la carte « Preuves » de tout marqueur déterministe.
    return {id:`det:${d.markerId}:${d.sense}:${d.evidenceRef}`,dyad,recordedAt:at,effectiveFrom:at,markerId:d.markerId,sense:d.sense,observedAt:d.observedAt,
      sourceEventIds:supports,state:'active',status:d.status==='accepted'?'accepted':'candidate',registryVersion:'reg-v6.0',detectorVersion:'normalized-detectors-v2',voluntariness:'unknown',intensity:'unknown',
      evidenceQuote:d.evidenceText}
  })}
}
export async function checked<T=any>(q:PromiseLike<{data:T;error:any}>):Promise<T> { const r=await q;if(r.error) throw new Error(r.error.message ?? String(r.error));return r.data }
export async function allRows(db:any,table:string,select:string,scope:(q:any)=>any) {
  const rows:any[]=[]
  for(let offset=0;;offset+=500){const batch=await checked<any[]>(scope(db.from(table).select(select)).order('id').range(offset,offset+499)); rows.push(...batch); if(batch.length<500)return rows}
}
export async function listDyads(db:any,after:string|null) { return checked<any[]>(db.rpc('v6_foundation_list',{p_after:after,p_limit:25})) }
export async function loadLedger(db:any,id:string) { return checked(db.rpc('v6_foundation_read',{p_dyad_id:id})) }
export async function scoreLedger(db:any,row:any,at:string,params:FoundationInput['params'],registry:FoundationInput['registry']) {
  const ledger=await loadLedger(db,row.id)
  const state=buildRelationalState({...ledger,dyad:{organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id},at,computedAt:at,params,registry})
  await checked(db.rpc('v6_foundation_store',{p_dyad_id:row.id,p_kind:'snapshot',p_payload:state}))
  return state
}
