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
    const body=await req.json().catch(()=>({}))
    const organizationId=typeof body.organizationId==='string'?body.organizationId:null
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'ingest'}))
    const rows=await checked<any[]>(db.rpc('v6_ingest_source_page',{
      p_after_created_at:cursor?.createdAt??null,p_after_id:cursor?.id??null,
      p_organization_id:organizationId,p_limit:500,
    })),at=new Date().toISOString()
    let imported=0,unattributed=0
    const qualityByDyad=new Map<string,{dyad:any;channels:Set<string>;from:string;to:string}>()
    for(const row of rows){
      // First materialization is knowledge NOW, not fabricated knowledge in the past.
      if(!row.sent_at){unattributed++;continue}
      const event=normalizeMessage({...row,updated_at:at})
      if(!event){unattributed++;continue}
      await checked(db.rpc('v6_foundation_append',{p_dyad:event.dyad,p_kind:'event',p_payload:event}));imported++
      const key=JSON.stringify(event.dyad),existing=qualityByDyad.get(key)
      if(existing){existing.channels.add(event.channel);if(event.eventTime<existing.from)existing.from=event.eventTime;if(event.eventTime>existing.to)existing.to=event.eventTime}
      else qualityByDyad.set(key,{dyad:event.dyad,channels:new Set([event.channel]),from:event.eventTime,to:event.eventTime})
    }
    for(const {dyad,channels,from,to} of qualityByDyad.values()){
      const observedChannels=[...channels].sort()
      await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'quality',p_payload:{
        id:'quality:structured-communications-v1',recordedAt:at,effectiveFrom:from,
        // reliability/reliabilityEvidence intentionally left unscored (null/[]): the
        // magnitude formula for structured-metadata confidence is a product decision,
        // not decided here.
        reliability:null,reliabilityEvidence:[],
        // Every event behind this quality record already passed normalizeMessage's
        // per-event identity check (contact_id only ever comes from
        // resolve_contact_identity, which refuses to guess on ambiguity). A text
        // channel with explicit From/To has no diarization ambiguity either — unlike
        // an audio transcript, there is no "who said this" to resolve.
        identity:'verified',diarization:'verified',completeness:observedChannels.length?'complete':'unknown',
        expectedChannels:null,observedChannels,periodStart:from,periodEnd:to,
      }}))
    }
    const last=rows.at(-1)
    if(last)await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'ingest',p_cursor:{createdAt:last.created_at,id:last.id}}))
    return json({imported,unattributed,quality_updates:qualityByDyad.size,next_after:rows.length===500?last.id:null})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
