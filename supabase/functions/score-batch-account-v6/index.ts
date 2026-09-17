// Canonical V6 runner. Writes immutable dyad and account snapshots only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { allRows,checked,listDyads,scoreLedger } from '../_shared/scoring-v6/pipeline.ts'
import { PARAMS_V6_PALIER,REGISTRY_V6 } from '../_shared/scoring-v6/registry-v6.ts'
import { ACCOUNT_SCORING_VERSION, buildCanonicalAccountState, type AccountHistoryPoint } from '../_shared/scoring-v6/account-state.ts'
import { SCORING_VERSION, type RelationalState } from '../_shared/scoring-v6/foundation.ts'
import type { CoverageTarget } from '../_shared/scoring-v6/types.ts'
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
const roleKey=(...values:Array<string|null|undefined>)=>{
  const value=values.filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if(/decideur|decision|economic buyer|signataire/.test(value))return 'decideur'
  if(/influenceur|prescripteur|champion|sponsor/.test(value))return 'influenceur'
  if(/filtre|gatekeeper|acheteur/.test(value))return 'filtre'
  if(/utilisateur|user|operationnel/.test(value))return 'utilisateur'
  return null
}
const relationType=(value:string|null|undefined)=>{
  const normalized=(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if(/client|prospect/.test(normalized))return 'Client/Prospect'
  if(/fournisseur/.test(normalized))return 'Fournisseur'
  if(/partenaire/.test(normalized))return 'Partenaire'
  if(/investisseur/.test(normalized))return 'Investisseur'
  if(/interne/.test(normalized))return 'Interne'
  return value?.trim() || 'unknown'
}
const historyPoint=(payload:any):AccountHistoryPoint=>({
  observedAt:payload.observedAt,score:payload.score??null,
  dials:Object.fromEntries(Object.entries(payload.dials??{}).map(([key,value]:any)=>[key,value?.value??null])),
  scoringVersion:payload.scoringVersion,paramsVersion:payload.paramsVersion,registryVersion:payload.registryVersion,
})
async function scoreAccounts(db:any,rows:any[],at:string){
  const contactIds=[...new Set(rows.map(row=>row.contact_id).filter(Boolean))]
  if(!contactIds.length)return {processed:0,scored:0,errors:[] as Array<{accountId:string;message:string}>}
  const contacts=await checked<any[]>(db.from('contacts').select('id,company_id').in('id',contactIds))
  const accountIds=[...new Set(contacts.map(contact=>contact.company_id).filter(Boolean))] as string[]
  let scored=0
  const errors:Array<{accountId:string;message:string}>=[]
  for(const accountId of accountIds){
    try{
      const account=await checked<any>(db.from('companies').select('id,organization_id,account_type').eq('id',accountId).single())
      const settings=await checked<any>(db.from('account_settings').select('relationship_status').eq('organization_id',account.organization_id).eq('company_id',accountId).maybeSingle())
      const companyContacts=await allRows(db,'contacts','id',q=>q.eq('organization_id',account.organization_id).eq('company_id',accountId).is('merged_into_contact_id',null))
      const ids=companyContacts.map((contact:any)=>contact.id)
      const messages=ids.length ? await allRows(db,'communication_messages','id,contact_id,sent_at',q=>q.eq('organization_id',account.organization_id).in('contact_id',ids).not('sent_at','is',null)) : []
      const roles=await checked<any[]>(db.from('account_contact_roles').select('contact_id,organizational_role,decision_role,relationship_role,source_type,inference_level,confidence,active').eq('organization_id',account.organization_id).eq('company_id',accountId).eq('active',true))
      const states=await checked<RelationalState[]>(db.rpc('v6_account_foundation_states',{p_organization_id:account.organization_id,p_company_id:accountId}))
      const historyPayloads=await checked<any[]>(db.rpc('v6_account_history',{p_organization_id:account.organization_id,p_company_id:accountId,p_limit:24}))
      const counts=new Map<string,number>()
      for(const message of messages)counts.set(message.contact_id,(counts.get(message.contact_id)??0)+1)
      const coverageTargets:CoverageTarget[]=roles.flatMap(role=>{
        // Automated role inference is context, never account authority.
        if(role.source_type!=='manual' && role.inference_level!=='manual')return []
        const key=roleKey(role.decision_role,role.relationship_role,role.organizational_role)
        if(!key)return []
        const count=counts.get(role.contact_id)??0
        const relationalLevel=count>=5?1:count>=2?.75:count===1?.5:0
        return [{role:key,authority:PARAMS_V6_PALIER.authority[key]!,covered:count>0,isDecider:key==='decideur',relationalLevel}]
      })
      const stateHistory=historyPayloads.map(historyPoint)
      const carriers=new Set(states.filter(state=>state.admissibility?.account).map(state=>state.entity.collaboratorUserId)).size
      const result=buildCanonicalAccountState({
        organizationId:account.organization_id,accountId,at,computedAt:new Date().toISOString(),
        relationType:relationType(settings?.relationship_status??account.account_type),dyads:states,coverageTargets,
        equilibreShares:[...counts.values()].filter(count=>count>0),carriers,kEvents:[],
        // Commitment outcomes are not yet present in the canonical account ledger.
        // Keep the entire dial unknown instead of injecting its neutral baseline.
        dynamics:{available:false,delta30OtherDials:0,daysSinceLast:0,cadenceMedian:0,engagementsHeld:0,engagementsSlipped:0},
        params:PARAMS_V6_PALIER,registry:REGISTRY_V6,history:stateHistory,
      })
      await checked(db.rpc('v6_account_store',{p_payload:result}))
      scored++
    }catch(error){errors.push({accountId,message:error instanceof Error?error.message:String(error)})}
  }
  return {processed:accountIds.length,scored,errors}
}
Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  const traceId=crypto.randomUUID(),startedAt=Date.now()
  let runId:string|null=null
  try {
    const principal=await authorizeWithClients(req,{},db,user,key)
    if(principal.kind!=='service')return json({error:'Forbidden'},403)
    runId=await checked<string>(db.rpc('v6_pipeline_run_start',{p_worker:'score-batch-account-v6',p_trace_id:traceId,p_versions:{dyad_scoring:SCORING_VERSION,account_scoring:ACCOUNT_SCORING_VERSION,params:PARAMS_V6_PALIER.version,registry:REGISTRY_V6.version}}))
    const body=await req.json().catch(()=>({})),at=new Date().toISOString()
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'score'}))
    const rows=await listDyads(db,body.after ?? cursor.after ?? null)
    for(const row of rows)await scoreLedger(db,row,at,PARAMS_V6_PALIER,REGISTRY_V6)
    const accounts=await scoreAccounts(db,rows,at)
    await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'score',p_cursor:{after:rows.length===25?rows.at(-1).id:null}}))
    const status=accounts.errors.length?'partial':'succeeded'
    await checked(db.rpc('v6_pipeline_run_finish',{p_run_id:runId,p_status:status,p_duration_ms:Date.now()-startedAt,p_counts:{dyads_processed:rows.length,accounts_processed:accounts.processed,accounts_scored:accounts.scored,account_errors:accounts.errors.length}}))
    return json({trace_id:traceId,processed:rows.length,next_after:rows.length===25?rows.at(-1).id:null,mode:'v6_canonical',accounts})
  }catch(e){
    const error=e instanceof Error?e.message:String(e)
    if(runId)await db.rpc('v6_pipeline_run_finish',{p_run_id:runId,p_status:'failed',p_duration_ms:Date.now()-startedAt,p_counts:{},p_error_code:'V6_PIPELINE_FAILED',p_error_message:error}).catch(()=>undefined)
    return json({trace_id:traceId,error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)
  }
})
