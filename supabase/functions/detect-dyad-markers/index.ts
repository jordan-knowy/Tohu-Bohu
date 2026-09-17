// New ledger only. Source adapters must preserve original ingestion and identity quality.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,listDyads,loadLedger,detectNormalizedEvents } from '../_shared/scoring-v6/pipeline.ts'
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  try{
    await authorizeWithClients(req,{},db,user,key)
    const body=await req.json().catch(()=>({})),at=new Date().toISOString()
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'detect'}))
    const rows=await listDyads(db,body.after ?? cursor.after ?? null)
    let count=0
    for(const row of rows){
      const dyad={organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id}
      const ledger=await loadLedger(db,row.id),detected=detectNormalizedEvents(ledger.events,dyad,at)
      if(detected.errors.length)throw new Error(detected.errors.join(','))
      await checked(db.rpc('v6_foundation_replace_detected', {
        p_dyad:dyad,p_at:at,p_markers:detected.markers,
      }))
      count+=detected.markers.length
    }
    await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'detect',p_cursor:{after:rows.length===25?rows.at(-1).id:null}}))
    return json({markers:count,next_after:rows.length===25?rows.at(-1).id:null})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
