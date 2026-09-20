// Phase 1 semantic observations. Candidate-only until calibrated; all outcomes audited.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,loadLedger } from '../_shared/scoring-v6/pipeline.ts'
import { revisionsAt } from '../_shared/scoring-v6/foundation.ts'
import { classifyObservations } from '../_shared/scoring-v6/semanticObservations.ts'
import { SEMANTIC_REGISTRY } from '../_shared/scoring-v6/semanticClassifier.ts'
import { getConfiguredModel } from '../_shared/llm-model-config.ts'
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-cron-secret'}
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers})
// Bounds per invocation: v6_foundation_find already restricts dyads to tracked
// contacts/accounts (is_tracked), so this budget only ever spends on entities
// the user actually added — never on a contact merely present in the mailbox.
const MAX_EVENTS_PER_RUN=30
const TIME_BUDGET_MS=45000
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const startedAt=Date.now()
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  try{
    const body=await req.json(),scope={organizationId:body.organizationId,contactId:body.contactId}
    // No service-role organization/event query until identity, membership and visibility are checked.
    const principal=await authorizeWithClients(req,scope,db,user,key)
    const apiKey=Deno.env.get('OPENROUTER_API_KEY')
    if(!apiKey)return json({error:'OPENROUTER_API_KEY missing'},503)
    const model=await getConfiguredModel(db,'analysis','OPENROUTER_ANALYSIS_MODEL','google/gemini-3.1-flash-lite')
    const cursor=principal.kind==='service'?await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'classify'})):{}
    const after=body.after ?? cursor.after ?? null
    const rows=await checked<any[]>(db.rpc('v6_foundation_find',{p_after:after,p_organization_id:body.organizationId ?? null,p_contact_id:principal.kind==='user'?body.contactId:null,p_collaborator_id:principal.kind==='user'?principal.userId:null})),at=new Date().toISOString()
    let analyzed=0,errors=0,lastCompletedDyadId:string|null=null
    for(const [rowIndex,row] of rows.entries()){
      if(principal.kind==='user' && (row.organization_id!==body.organizationId || row.contact_id!==body.contactId || row.collaborator_user_id!==principal.userId))continue
      if(principal.kind==='service' && body.organizationId && row.organization_id!==body.organizationId)continue
      const ledger=await loadLedger(db,row.id),revisionErrors:string[]=[]
      // Raw email events never carry evidenceText (no body storage) — filtering
      // them out here means the per-run budget is spent only on events that can
      // ever produce something, instead of being starved by hundreds of emails
      // known in advance to hit SOURCE_TEXT_UNAVAILABLE.
      const events=revisionsAt<any>(ledger.events,Date.parse(at),revisionErrors).filter(e=>e.state==='observed' && Date.parse(e.eventTime)<=Date.parse(at) && e.evidenceText?.trim())
      if(revisionErrors.length)throw new Error(revisionErrors.join(','))
      // Explicit page through source events; no silent fixed 40-extract horizon.
      // eventOffset from checkpoint only resumes the first dyad of this page —
      // a fresh dyad reached later in the same run always starts at 0.
      const resumedOffset=rowIndex===0 && Number.isSafeInteger(body.eventOffset)&&body.eventOffset>=0 ? body.eventOffset : (rowIndex===0 ? (cursor.eventOffset ?? 0) : 0)
      let offset=resumedOffset
      while(offset<events.length){
        if(analyzed>=MAX_EVENTS_PER_RUN || Date.now()-startedAt>TIME_BUDGET_MS)break
        const event=events[offset]
        const result=await classifyObservations({text:event.evidenceText ?? '',sourceEventId:event.id,model,registryVersion:'reg-v6.0',at},async prompt=>{
          const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({model,temperature:0,max_tokens:1500,response_format:{type:'json_object'},messages:[{role:'user',content:prompt}]})})
          if(!response.ok)throw new Error(`HTTP_${response.status}`)
          const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content ?? '')
        })
        await checked(db.rpc('v6_foundation_store',{p_dyad_id:row.id,p_kind:'classifier_run',p_payload:result}))
        // The classifier_run record above is an audit trail — nothing ever read it
        // back into scoring (foundation_revision only feeds markers of kind='marker').
        // Promote each closed-registry 'marker' observation into one, so Confiance/
        // Engagement axes can finally be observed. 'evidence' is guaranteed to be a
        // literal substring of the source text (enforced in parseObservations), so
        // it doubles as the verbatim quote S07 requires.
        const dyad={organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id}
        for(const obs of result.observations){
          if(obs.type!=='marker' || !obs.marker_candidate)continue
          const entry=SEMANTIC_REGISTRY[obs.marker_candidate]
          if(!entry || (entry.sense!==1 && entry.sense!==-1))continue
          const accepted=obs.confidence==null || obs.confidence>=0.6
          await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'marker',p_payload:{
            id:`sem:${obs.marker_candidate}:${entry.sense}:${event.id}`,dyad,recordedAt:at,effectiveFrom:at,
            markerId:obs.marker_candidate,sense:entry.sense,observedAt:event.eventTime,
            sourceEventIds:[event.id],state:'active',status:accepted?'accepted':'candidate',
            registryVersion:'reg-v6.0',detectorVersion:'semantic-observations-v2',
            voluntariness:obs.voluntariness,intensity:'unknown',
            ...(entry.requiresVerbatim?{criticalValidated:true,evidenceQuote:obs.evidence}:{}),
          }}))
        }
        analyzed++;offset++;if(result.result_status==='technical_error')errors++
      }
      if(offset<events.length || Date.now()-startedAt>TIME_BUDGET_MS || analyzed>=MAX_EVENTS_PER_RUN){
        // Interrupted mid-dyad (budget or time). Resume from the last fully
        // completed dyad so this row is re-listed first on the next call.
        if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after:lastCompletedDyadId ?? after,eventOffset:offset}}))
        return json({analyzed,technical_errors:errors,next_after:lastCompletedDyadId ?? after,next_dyad_id:row.id,next_event_offset:offset})
      }
      lastCompletedDyadId=row.id
    }
    const next=rows.at(-1)?.id ?? null
    if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after:next,eventOffset:0}}))
    return json({analyzed,technical_errors:errors,next_after:next})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
