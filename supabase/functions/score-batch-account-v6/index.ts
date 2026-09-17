// Phase 1 shadow foundation runner. Never writes the old V6/Legacy product snapshots.
// Team-person/account aggregation is deliberately pending empirical validation.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,listDyads,scoreLedger } from '../_shared/scoring-v6/pipeline.ts'
import { PARAMS_V6_PALIER,REGISTRY_V6 } from '../_shared/scoring-v6/registry-v6.ts'
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  try {
    const principal=await authorizeWithClients(req,{},db,user,key)
    if(principal.kind!=='service')return json({error:'Forbidden'},403)
    const body=await req.json().catch(()=>({})),at=new Date().toISOString()
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'score'}))
    const rows=await listDyads(db,body.after ?? cursor.after ?? null)
    for(const row of rows)await scoreLedger(db,row,at,PARAMS_V6_PALIER,REGISTRY_V6)
    await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'score',p_cursor:{after:rows.length===25?rows.at(-1).id:null}}))
    return json({processed:rows.length,next_after:rows.length===25?rows.at(-1).id:null,mode:'foundation_shadow',account_aggregation:'pending_validation'})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
