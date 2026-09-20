// Text-extract ingestion: person_key_moments.summary / person_memory_entries
// (commitment).source_excerpt are already-derived, already-persisted excerpts —
// never the raw email body (never stored). This feeds classify-markers the only
// text it was ever meant to see per the doctrine comment in semanticClassifier.ts.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {authorizeWithClients} from '../_shared/scoring-v6/authorization.ts'
import {checked} from '../_shared/scoring-v6/pipeline.ts'
Deno.serve(async(req)=>{
  const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const db=createClient(url,key??''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:req.headers.get('authorization')??''}}})
  try{
    await authorizeWithClients(req,{},db,user,key)
    const body=await req.json().catch(()=>({}))
    const organizationId=typeof body.organizationId==='string'?body.organizationId:null
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'ingest_text'}))
    const rows=await checked<any[]>(db.rpc('v6_ingest_text_source_page',{
      p_after_created_at:cursor?.createdAt??null,p_after_id:cursor?.id??null,
      p_organization_id:organizationId,p_limit:500,
    })),at=new Date().toISOString()
    let imported=0,skipped=0
    for(const row of rows){
      if(!row.text || !row.owner_user_id){skipped++;continue}
      const dyad={organizationId:row.organization_id,collaboratorUserId:row.owner_user_id,contactId:row.contact_id}
      const event={
        id:`${row.kind}:${row.id}:${row.owner_user_id}`,dyad,accountId:null,
        sourceEventId:String(row.id),sourceType:row.kind,channel:'derived_text',
        eventTime:row.occurred_at,ingestedAt:row.created_at,recordedAt:at,effectiveFrom:row.occurred_at,
        state:'observed',internalActorId:row.owner_user_id,externalActorId:row.contact_id,
        participants:[row.owner_user_id,row.contact_id],ownerUserId:row.owner_user_id,
        evidenceRef:`${row.kind==='key_moment'?'person_key_moments':'person_memory_entries'}:${row.id}`,
        evidenceUnitId:`${row.kind}:${row.id}`,
        // Same identity reasoning as email: contact_id here comes from the same
        // resolution as the source email that produced this excerpt — not a guess.
        // completeness='complete': the excerpt itself is the whole substance to
        // classify, unlike a raw message missing its body.
        identityQuality:'verified',completeness:'complete',
        sourceVersion:'text-extract-adapter-v1',participationObserved:true,evidenceText:row.text,
      }
      await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'event',p_payload:event}))
      imported++
    }
    const last=rows.at(-1)
    if(last)await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'ingest_text',p_cursor:{createdAt:last.created_at,id:last.id}}))
    return json({imported,skipped,next_after:rows.length===500?last.id:null})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
