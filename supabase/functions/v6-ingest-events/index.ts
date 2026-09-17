// Explicit additive import into shadow ledger; original source records are never changed.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {authorizeWithClients} from '../_shared/scoring-v6/authorization.ts'
import {normalizeMessage} from '../_shared/scoring-v6/adapters.ts'
import {checked} from '../_shared/scoring-v6/pipeline.ts'
Deno.serve(async(req)=>{
  const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const db=createClient(url,key??''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:req.headers.get('authorization')??''}}})
  try{
    await authorizeWithClients(req,{},db,user,key)
    const body=await req.json()
    if(typeof body.organizationId!=='string')return json({error:'organizationId required'},400)
    let q=db.from('communication_messages').select('*,contacts(company_id)').eq('organization_id',body.organizationId).order('id').limit(100)
    if(body.after)q=q.gt('id',body.after)
    const rows=await checked<any[]>(q),at=new Date().toISOString()
    let imported=0,unattributed=0
    for(const row of rows){
      // First materialization is knowledge NOW, not fabricated knowledge in the past.
      const event=normalizeMessage({...row,account_id:row.contacts?.company_id,updated_at:at})
      if(!event){unattributed++;continue}
      await checked(db.rpc('v6_foundation_append',{p_dyad:event.dyad,p_kind:'event',p_payload:event}));imported++
    }
    return json({imported,unattributed,quality:'unknown_until_verified',next_after:rows.length===100?rows.at(-1).id:null})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
