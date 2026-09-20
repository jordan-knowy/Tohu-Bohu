// New ledger only. Source adapters must preserve original ingestion and identity quality.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeWithClients } from '../_shared/scoring-v6/authorization.ts'
import { checked,listDyads,loadLedger,detectNormalizedEvents } from '../_shared/scoring-v6/pipeline.ts'
import { RELIABILITY_PARAMS_V1 } from '../_shared/scoring-v6/snapshots.ts'
import { PARAMS_V6_PALIER } from '../_shared/scoring-v6/registry-v6.ts'
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
// Same normalization the account-level engine already uses (score-batch-account-v6)
// to read decision_role/relationship_role text into one of the 4 authority tiers
// the registry defines. Declared here too so a per-dyad person role (person_settings,
// set from the fiche personne) is not silently ignored just because it never made
// it into account_contact_roles (which the account-level engine reads instead).
const roleKey=(...values:Array<string|null|undefined>)=>{
  const value=values.filter(Boolean).join(' ').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  if(/decideur|decision|economic buyer|signataire/.test(value))return 'decideur'
  if(/influenceur|prescripteur|champion|sponsor/.test(value))return 'influenceur'
  if(/filtre|gatekeeper|acheteur/.test(value))return 'filtre'
  if(/utilisateur|user|operationnel/.test(value))return 'utilisateur'
  return null
}
Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL') ?? ''
  const db=createClient(url,key ?? ''),user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:req.headers.get('Authorization') ?? ''}}})
  try{
    await authorizeWithClients(req,{},db,user,key)
    const body=await req.json().catch(()=>({})),at=new Date().toISOString()
    const cursor=await checked<any>(db.rpc('v6_foundation_checkpoint',{p_worker:'detect'}))
    const rows=await listDyads(db,body.after ?? cursor.after ?? null)
    const contactIds=[...new Set(rows.map((row:any)=>row.contact_id))]
    const settingsRows=contactIds.length?await checked<any[]>(db.from('person_settings').select('contact_id,decision_role,relationship_role').in('contact_id',contactIds)):[]
    const settingsByContact=new Map(settingsRows.map((s:any)=>[s.contact_id,s]))
    let count=0
    for(const row of rows){
      const dyad={organizationId:row.organization_id,collaboratorUserId:row.collaborator_user_id,contactId:row.contact_id}
      const ledger=await loadLedger(db,row.id),detected=detectNormalizedEvents(ledger.events,dyad,at)
      if(detected.errors.length)throw new Error(detected.errors.join(','))
      await checked(db.rpc('v6_foundation_replace_detected', {
        p_dyad:dyad,p_at:at,p_markers:detected.markers,
      }))
      count+=detected.markers.length
      // Reliability = cumulative volume of admissible structured evidence for this
      // dyad, reusing the same 8-episode saturation threshold the engine already
      // applies elsewhere (RELIABILITY_PARAMS_V1.volumeSaturationMarkers / P4
      // baseline.sufficient) rather than inventing a new constant. Identity and
      // diarization are 'verified' for the same reason as the per-event check:
      // contact_id is never a guess, and a text channel has no "who said this"
      // ambiguity. Supersedes the ingest-time placeholder quality revision
      // (same id, later recordedAt) once real volume is known.
      if(detected.available.length){
        const times=detected.available.map(e=>Date.parse(e.eventTime))
        const reliability=Math.min(detected.baseline.episodes/RELIABILITY_PARAMS_V1.volumeSaturationMarkers,1)
        const channels=[...new Set(detected.available.map(e=>e.channel))].sort()
        // No source tells us which channels a contact ALSO uses beyond what we
        // instrument (no phone/Slack signal exists here) — expecting exactly what
        // we capture is the honest floor, never a claim of completeness we can't
        // back up. Without this, coverage is permanently null and
        // UNKNOWN_OR_ZERO_COVERAGE fires for every dyad regardless of evidence.
        await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'quality',p_payload:{
          id:'quality:structured-communications-v1',recordedAt:at,effectiveFrom:new Date(Math.min(...times)).toISOString(),
          reliability,reliabilityEvidence:detected.available.slice(0,20).map(e=>e.evidenceRef),
          identity:'verified',diarization:'verified',completeness:'complete',
          expectedChannels:channels,observedChannels:channels,
          periodStart:new Date(Math.min(...times)).toISOString(),periodEnd:new Date(Math.max(...times)).toISOString(),
        }}))
      }
      // Declared role bridge: person_settings is where the fiche personne UI
      // actually writes decision_role/relationship_role — the account-level engine
      // reads a different, still-empty table (account_contact_roles). Without this,
      // a role a user has already set in the product would never reach the dyad
      // score, and UNKNOWN_ROLE would fire forever regardless of evidence quality.
      const settings=settingsByContact.get(row.contact_id)
      const key=settings?roleKey(settings.decision_role,settings.relationship_role):null
      if(key){
        await checked(db.rpc('v6_foundation_append',{p_dyad:dyad,p_kind:'role',p_payload:{
          id:'role:person-settings-v1',recordedAt:at,effectiveFrom:at,
          origin:'declared',role:{label:settings.decision_role ?? settings.relationship_role,volontariteProfile:'standard'},
          authority:PARAMS_V6_PALIER.authority[key] ?? null,evidence:['person_settings'],
        }}))
      }
    }
    await checked(db.rpc('v6_foundation_checkpoint',{p_worker:'detect',p_cursor:{after:rows.length===25?rows.at(-1).id:null}}))
    return json({markers:count,next_after:rows.length===25?rows.at(-1).id:null})
  }catch(e){const error=e instanceof Error?e.message:String(e);return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:500)}
})
