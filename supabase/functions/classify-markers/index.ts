// Phase 1 semantic observations. Candidate-only until calibrated; all outcomes audited.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,loadLedger } from '../_shared/scoring-v6/pipeline.ts'
import { revisionsAt } from '../_shared/scoring-v6/foundation.ts'
import { classifyObservations,PROMPT_VERSION } from '../_shared/scoring-v6/semanticObservations.ts'
import { SEMANTIC_REGISTRY } from '../_shared/scoring-v6/semanticClassifier.ts'
import { extractAuthoredText } from '../_shared/scoring-v6/emailText.ts'
import { getConfiguredModel } from '../_shared/llm-model-config.ts'
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-cron-secret'}
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers})
// Bounds per invocation: v6_foundation_find already restricts dyads to tracked
// contacts/accounts (is_tracked), so this budget only ever spends on entities
// the user actually added — never on a contact merely present in the mailbox.
const MAX_EVENTS_PER_RUN=30
const TIME_BUDGET_MS=40000
const CONCURRENCY=4
// A thread the contact opened counts as a substantial initiation (R02) only if its authored text
// is more than a one-liner: the marker is « initiation substantielle vs relance », which needs the body.
const SUBSTANTIAL_INITIATION_CHARS=150
const INITIATION_WINDOW_MS=182*86_400_000
const CALL_TIMEOUT_MS=60000 // budget + one batch stays under the 150 s platform limit
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
      const observed=revisionsAt<any>(ledger.events,Date.parse(at),revisionErrors).filter(e=>e.state==='observed' && Date.parse(e.eventTime)<=Date.parse(at))
      if(revisionErrors.length)throw new Error(revisionErrors.join(','))
      // Email events never carry evidenceText in the ledger (the body is not copied
      // into the scoring schema). The text is read from its single source of truth,
      // communication_messages.body_text, at classification time and kept in memory
      // only. Only INBOUND mail is classified: every registry marker describes what
      // the contact says or does, so our own outbound wording must never be read as
      // theirs. Quoted history is stripped for the same reason (extractAuthoredText).
      const mailIds=observed.filter(e=>!e.evidenceText?.trim() && e.sourceType==='communication_message' && e.direction==='inbound' && typeof e.evidenceRef==='string').map(e=>e.evidenceRef.replace('communication_messages:',''))
      const bodies=new Map<string,string>()
      for(let i=0;i<mailIds.length;i+=100){
        const chunk=await checked<any[]>(db.from('communication_messages').select('id,body_text').in('id',mailIds.slice(i,i+100)).not('body_text','is',null))
        for(const m of chunk){const text=extractAuthoredText(m.body_text);if(text)bodies.set(m.id,text)}
      }
      // Already-classified events are skipped (a technical_error is retried), so a
      // full cycle over the dyads never pays the LLM twice for the same text.
      const done=new Set<string>(await checked<string[]>(db.rpc('v6_classified_event_ids',{p_dyad_id:row.id,p_prompt_version:PROMPT_VERSION})))
      const events=observed.map(e=>e.evidenceText?.trim()?e:{...e,evidenceText:bodies.get(String(e.evidenceRef).replace('communication_messages:',''))}).filter(e=>e.evidenceText?.trim() && !done.has(e.id))
      // R02 (initiation substantielle) from real content: the first message of a thread, sent by the
      // contact, with a substantial authored body. Deterministic, one marker per thread, idempotent
      // through the marker id. Until now R02 stayed a candidate because "substantial" needs the body.
      const known=new Set<string>((ledger.markers as any[]).map(m=>m.id)),dyadForR02={organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id}
      const firstByThread=new Map<string,any>()
      for(const e of observed){if(!e.threadId||!e.direction)continue;const cur=firstByThread.get(e.threadId);if(!cur||Date.parse(e.eventTime)<Date.parse(cur.eventTime))firstByThread.set(e.threadId,e)}
      for(const e of firstByThread.values()){
        if(e.direction!=='inbound' || Date.parse(at)-Date.parse(e.eventTime)>INITIATION_WINDOW_MS)continue
        const text=bodies.get(String(e.evidenceRef).replace('communication_messages:',''))
        const id=`body:R02:1:${e.id}`
        if(!text || text.length<SUBSTANTIAL_INITIATION_CHARS || known.has(id))continue
        await checked(db.rpc('v6_foundation_append',{p_dyad:dyadForR02,p_kind:'marker',p_payload:{
          id,dyad:dyadForR02,recordedAt:at,effectiveFrom:at,markerId:'R02',sense:1,observedAt:e.eventTime,
          sourceEventIds:[e.id],state:'active',status:'accepted',registryVersion:'reg-v6.0',detectorVersion:'body-initiation-v1',
          voluntariness:'unknown',intensity:'unknown',
          // Extrait réel du fil qu'il a ouvert — pour la carte « Preuves », jamais utilisé dans le calcul.
          evidenceQuote:text.slice(0,240),
        }}))
      }
      // `events` already excludes what a previous run classified, so every run simply
      // resumes at the first unclassified event: no stored offset (which would drift as
      // the list shrinks) is needed. A technical_error stays in the list and is retried.
      let offset=0
      while(offset<events.length){
        if(analyzed>=MAX_EVENTS_PER_RUN || Date.now()-startedAt>TIME_BUDGET_MS)break
        // Calls run CONCURRENCY at a time: a reasoning model answers in tens of seconds, so a
        // sequential loop finished one or two events per invocation.
        const batch=events.slice(offset,offset+Math.min(CONCURRENCY,MAX_EVENTS_PER_RUN-analyzed))
        const results=await Promise.all(batch.map(event=>classifyObservations({text:event.evidenceText ?? '',sourceEventId:event.id,model,registryVersion:'reg-v6.0',at},async prompt=>{
          // Classification picks from a closed list: no chain-of-thought needed. Every run so far
          // ended in "Signal timed out" at the previous 20 s limit (the analysis model is a reasoning model).
          const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(CALL_TIMEOUT_MS),body:JSON.stringify({model,temperature:0,max_tokens:2000,reasoning:{enabled:false},response_format:{type:'json_object'},messages:[{role:'user',content:prompt}]})})
          if(!response.ok)throw new Error(`HTTP_${response.status}`)
          const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content ?? '')
        })))
        for(const [index,result] of results.entries()){
          const event=batch[index]
          await checked(db.rpc('v6_foundation_store',{p_dyad_id:row.id,p_kind:'classifier_run',p_payload:result}))
          // The classifier_run record above is an audit trail — nothing ever read it
          // back into scoring (foundation_revision only feeds markers of kind='marker').
          // Promote each closed-registry 'marker' observation into one, so Confiance/
          // Engagement axes can finally be observed. 'evidence' is guaranteed to be a
          // literal substring of the source text (enforced in parseObservations), so
          // it doubles as the verbatim quote S07 requires.
          const dyad={organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id}
          // Un même marqueur peut être renvoyé deux fois pour un email (citations
          // différentes) : même id + même recordedAt = IMMUTABLE_REVISION_CONFLICT.
          // On garde la première observation par marqueur et par événement.
          const seenMarkers=new Set<string>()
          for(const obs of result.observations){
            if(obs.type!=='marker' || !obs.marker_candidate)continue
            if(seenMarkers.has(obs.marker_candidate))continue
            seenMarkers.add(obs.marker_candidate)
            const entry=SEMANTIC_REGISTRY[obs.marker_candidate]
            if(!entry || (entry.sense!==1 && entry.sense!==-1))continue
            // A critical marker (S07: Satisfaction capped at 20) is never scored on an
            // LLM reading alone — it needs the human double validation the doctrine
            // requires, so it is stored as a candidate with its verbatim quote.
            const accepted=!entry.requiresVerbatim && (obs.confidence==null || obs.confidence>=0.6)
            await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'marker',p_payload:{
              id:`sem:${obs.marker_candidate}:${entry.sense}:${event.id}`,dyad,recordedAt:at,effectiveFrom:at,
              markerId:obs.marker_candidate,sense:entry.sense,observedAt:event.eventTime,
              sourceEventIds:[event.id],state:'active',status:accepted?'accepted':'candidate',
              registryVersion:'reg-v6.0',detectorVersion:'semantic-observations-v2',
              voluntariness:obs.voluntariness,intensity:'unknown',
              // La citation est toujours enregistrée (pas seulement pour les marqueurs
              // critiques) — elle alimente la carte « Preuves » ; 'evidence' est déjà
              // garanti substring littéral du texte source (parseObservations).
              evidenceQuote:obs.evidence,
              ...(entry.requiresVerbatim?{criticalValidated:false}:{}),
            }}))
          }
          analyzed++;if(result.result_status==='technical_error')errors++
        }
        offset+=batch.length
      }
      if(offset<events.length || Date.now()-startedAt>TIME_BUDGET_MS || analyzed>=MAX_EVENTS_PER_RUN){
        // Interrupted mid-dyad (budget or time). Resume from the last fully
        // completed dyad so this row is re-listed first on the next call.
        if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after:lastCompletedDyadId ?? after,eventOffset:0}}))
        return json({analyzed,technical_errors:errors,next_after:lastCompletedDyadId ?? after,next_dyad_id:row.id,next_event_offset:offset})
      }
      lastCompletedDyadId=row.id
    }
    const next=rows.at(-1)?.id ?? null
    if(principal.kind==='service')await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'classify',p_cursor:{after:next,eventOffset:0}}))
    return json({analyzed,technical_errors:errors,next_after:next})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
