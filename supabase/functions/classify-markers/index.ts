// Phase 1 semantic observations. Candidate-only until calibrated; all outcomes audited.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,loadLedger } from '../_shared/scoring-v6/pipeline.ts'
import { revisionsAt } from '../_shared/scoring-v6/foundation.ts'
import { classifyObservations } from '../_shared/scoring-v6/semanticObservations.ts'
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-cron-secret'}
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers})
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  try{
    const body=await req.json(),scope={organizationId:body.organizationId,contactId:body.contactId}
    // No service-role organization/event query until identity, membership and visibility are checked.
    const principal=await authorizeWithClients(req,scope,db,user,key)
    const apiKey=Deno.env.get('OPENROUTER_API_KEY')
    if(!apiKey)return json({error:'OPENROUTER_API_KEY missing'},503)
    const cursor=principal.kind==='service'?await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'classify'})):{}
    const after=body.after ?? cursor.after ?? null
    const rows=await checked<any[]>(db.rpc('v6_foundation_find',{p_after:after,p_organization_id:body.organizationId ?? null,p_contact_id:principal.kind==='user'?body.contactId:null,p_collaborator_id:principal.kind==='user'?principal.userId:null})),at=new Date().toISOString()
    let analyzed=0,errors=0
    for(const row of rows.slice(0,1)){
      if(principal.kind==='user' && (row.organization_id!==body.organizationId || row.contact_id!==body.contactId || row.collaborator_user_id!==principal.userId))continue
      if(principal.kind==='service' && body.organizationId && row.organization_id!==body.organizationId)continue
      const ledger=await loadLedger(db,row.id),revisionErrors:string[]=[]
      const events=revisionsAt<any>(ledger.events,Date.parse(at),revisionErrors).filter(e=>e.state==='observed' && Date.parse(e.eventTime)<=Date.parse(at))
      if(revisionErrors.length)throw new Error(revisionErrors.join(','))
      // Explicit page through source events; no silent fixed 40-extract horizon.
      const offset=Number.isSafeInteger(body.eventOffset) && body.eventOffset>=0?body.eventOffset:(cursor.eventOffset ?? 0)
      for(const event of events.slice(offset,offset+1)){
        const model=Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite'
        const result=await classifyObservations({text:event.evidenceText ?? '',sourceEventId:event.id,model,registryVersion:'reg-v6.0',at},async prompt=>{
          const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({model,temperature:0,max_tokens:1500,response_format:{type:'json_object'},messages:[{role:'user',content:prompt}]})})
          if(!response.ok)throw new Error(`HTTP_${response.status}`)
          const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content ?? '')
        })
        await checked(db.rpc('v6_foundation_store',{p_dyad_id:row.id,p_kind:'classifier_run',p_payload:result}))
        analyzed++;if(result.result_status==='technical_error')errors++
      }
      if(events.length>offset+1){
        if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after,eventOffset:offset+1}}))
        return json({analyzed,technical_errors:errors,next_after:after,next_dyad_id:row.id,next_event_offset:offset+1})
      }
    }
    const next=rows[0]?.id ?? null
    if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after:next,eventOffset:0}}))
    return json({analyzed,technical_errors:errors,next_after:next})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
