#!/usr/bin/env node
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {readFile,rename,writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=dirname(fileURLToPath(import.meta.url)),privateDir=process.env.V6_ANNOTATION_PRIVATE_DIR?resolve(process.env.V6_ANNOTATION_PRIVATE_DIR):resolve(root,'private')
const candidatesPath=resolve(privateDir,'candidates.v2.json'),privacyPath=resolve(privateDir,'privacy-review.json'),privacyFrozenPath=resolve(privateDir,'privacy-frozen.json')
const labelKeys=['expected_facts','expected_markers','forbidden_markers','expected_commitments','expected_roles','indeterminable_fields']
const markerDefinitions={
 C01:'divulgation non nécessaire',C02:'réduction des copies vs baseline',C03:'baisse du hedging vs baseline',C04:'registre plus informel vs baseline',C05:'jugement personnel sur un tiers absent',
 S01:'retour vers plus de formalité',S02:'escalade vers une personne plus senior',S03:'appréciation négative explicite et ciblée',S04:'demande relancée au moins deux fois sans réponse',S05:'rituel annulé non replanifié',S06:'contournement établi',S07:'dénonciation explicite auprès d’un tiers',S08:'éloge spontané spécifique',
 E01:'introduction effective à un tiers',E02:'ouverture effective de l’organisation',E03:'projection explicite au-delà de l’engagement courant',E04:'livrable utile non demandé',E05:'acceptation ou refus de réunions vs baseline',
 R01:'asymétrie de latence vs baseline',R02:'initiation substantielle vs relance',A01:'diversité de canaux actifs',A02:'continuité entre périodes',
 K01:'contrat signé sans flux attendu',K02:'créance échue non réglée',K03:'demande formelle sans réponse',K04:'livrable contractuel en retard',K05:'porteur parti sans passation',K06:'rétention explicite de livrable comme pression',K07:'incident ouvert ou résolu',K08:'adresse de contact invalide',K09:'décideur couvert seulement par escalade',
 X01:'canal probablement non instrumenté',X02:'rupture explicitement typée',X03:'rupture de rituel causée par notre côté'
}
const emptyLabels=()=>({expected_facts:[],expected_markers:[],forbidden_markers:[],expected_commitments:[],expected_roles:[],expected_direction:'indeterminable',indeterminable_fields:[]})
const readJson=async(path,fallback)=>existsSync(path)?JSON.parse(await readFile(path,'utf8')):fallback
const atomic=async(path,value)=>{const temp=path+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,path)}
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const normalizeLabels=labels=>{const out=emptyLabels();for(const key of labelKeys)out[key]=[...new Set((labels?.[key]??[]).map(String).map(x=>x.trim()).filter(Boolean))].sort();out.expected_direction=['up','stable','down','indeterminable'].includes(labels?.expected_direction)?labels.expected_direction:'indeterminable';return out}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const publicCase=c=>({id:c.id,case_type:c.case_type,source_completeness:c.source_completeness,events:c.events,participants:c.participants,timestamps:c.timestamps,channel:c.channel,context_before:c.context_before,context_after:c.context_after,context_facts:c.context_facts,privacy_findings:c.privacy_findings})
const frozenPath=role=>resolve(privateDir,`annotation-${role}-frozen.json`),statePath=role=>resolve(privateDir,`annotation-${role}.json`)

async function eligibleCases(){const frozen=await readJson(privacyFrozenPath,null);if(!frozen)throw new Error('Run and freeze privacy review first');return frozen.cases.filter(c=>c.privacy_reviewed&&c.annotation_possible)}
async function freezePrivacy(reviewer){
 const candidates=await readJson(candidatesPath,[]),state=await readJson(privacyPath,{})
 const missing=candidates.filter(c=>!state[c.id]||typeof state[c.id].privacy_reviewed!=='boolean'||typeof state[c.id].annotation_possible!=='boolean')
 if(missing.length)throw new Error(`PRIVACY_REVIEW_INCOMPLETE:${missing.length}`)
 for(const c of candidates){if(!state[c.id].privacy_reviewed)continue;const text=(state[c.id].events??c.events).map(e=>e.text??'').join('\n');if(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)||/\bhttps?:\/\/|\bwww\./i.test(text)||/(?:\+?\d[\d .()/-]{7,}\d)/.test(text))throw new Error(`PRIVACY_IDENTIFIER_REMAINS:${c.id}`)}
 const cases=candidates.map(c=>({...c,...state[c.id]}));const payload={reviewer,frozen_at:new Date().toISOString(),source_sha256:sha(candidates),cases}
 await atomic(privacyFrozenPath,payload);return {cases:cases.length,annotatable:cases.filter(c=>c.privacy_reviewed&&c.annotation_possible).length,excluded:cases.filter(c=>!c.annotation_possible).length}
}
async function freezeAnnotation(role,annotator){
 const cases=await eligibleCases(),state=await readJson(statePath(role),{}),missing=cases.filter(c=>!state[c.id]?.complete)
 if(missing.length)throw new Error(`ANNOTATION_${role}_INCOMPLETE:${missing.length}`)
 const answers=Object.fromEntries(cases.map(c=>[c.id,{id:annotator,labels:normalizeLabels(state[c.id].labels),evidence_notes:String(state[c.id].evidence_notes??'')}]))
 const payload={role,annotator,frozen_at:new Date().toISOString(),cases_sha256:sha(cases),answers};await atomic(frozenPath(role),payload);return {role,cases:cases.length,sha256:sha(payload)}
}
async function buildDiff(){
 const cases=await eligibleCases(),a=await readJson(frozenPath('A'),null),b=await readJson(frozenPath('B'),null)
 if(!a||!b)throw new Error('Freeze A and B first');if(a.annotator===b.annotator)throw new Error('ANNOTATORS_NOT_INDEPENDENT')
 const queue=[]
 for(const c of cases){const la=a.answers[c.id].labels,lb=b.answers[c.id].labels,differences=[],agreed={};for(const key of [...labelKeys,'expected_direction']){if(!same(la[key],lb[key]))differences.push({field:key,A:la[key],B:lb[key]});else agreed[key]=la[key]}if(differences.length)queue.push({case:publicCase(c),agreed_labels:agreed,differences,A_notes:a.answers[c.id].evidence_notes,B_notes:b.answers[c.id].evidence_notes})}
 const payload={created_at:new Date().toISOString(),A_sha256:sha(a),B_sha256:sha(b),total_cases:cases.length,agreement_cases:cases.length-queue.length,queue};await atomic(resolve(privateDir,'arbitration-queue.json'),payload);return {total:cases.length,agreements:cases.length-queue.length,disagreements:queue.length}
}
async function freezeArbitration(arbitrator){
 const cases=await eligibleCases(),a=await readJson(frozenPath('A'),null),b=await readJson(frozenPath('B'),null),queue=await readJson(resolve(privateDir,'arbitration-queue.json'),null),state=await readJson(resolve(privateDir,'arbitration.json'),{})
 if(!a||!b||!queue)throw new Error('Build disagreement queue first')
 const missing=queue.queue.filter(q=>!state[q.case.id]?.complete);if(missing.length)throw new Error(`ARBITRATION_INCOMPLETE:${missing.length}`)
 const gold=cases.map(c=>{const la=a.answers[c.id].labels,lb=b.answers[c.id].labels,diff=queue.queue.find(q=>q.case.id===c.id),labels=diff?normalizeLabels({...diff.agreed_labels,...state[c.id].labels}):la;return {...c,annotator_A:{id:a.annotator,labels:la},annotator_B:{id:b.annotator,labels:lb},arbitration:{id:arbitrator,labels,disagreements:diff?.differences.map(d=>d.field)??[]}}})
 const payload={dataset_version:'tohu-gold-v1',frozen_at:new Date().toISOString(),annotators:{A:a.annotator,B:b.annotator,arbitrator},source:{privacy_sha256:sha(await readJson(privacyFrozenPath,null)),A_sha256:sha(a),B_sha256:sha(b)},cases:gold}
 await atomic(resolve(privateDir,'gold.v1.json'),payload);return {cases:gold.length,development:gold.filter(c=>c.split==='development').length,holdout:gold.filter(c=>c.split==='holdout').length,sha256:sha(payload)}
}
async function config(role,annotator){
 if(role==='privacy'){const cases=await readJson(candidatesPath,[]);return {role,annotator,cases:cases.map(publicCase),state:await readJson(privacyPath,{}),markerDefinitions:{}}}
 if(role==='arbitration'){const queue=await readJson(resolve(privateDir,'arbitration-queue.json'),null);if(!queue)throw new Error('Run diff first');return {role,annotator,cases:queue.queue,state:await readJson(resolve(privateDir,'arbitration.json'),{}),markerDefinitions}}
 if(!['A','B'].includes(role))throw new Error('role must be privacy, A, B or arbitration')
 const cases=await eligibleCases();cases.sort((x,y)=>sha(role+x.id).localeCompare(sha(role+y.id)))
 return {role,annotator,cases:cases.map(publicCase),state:await readJson(statePath(role),{}),markerDefinitions}
}
async function serve(role,annotator,port){
 if(!annotator)throw new Error('annotator/reviewer id is required')
 const html=await readFile(resolve(root,'annotation-app.html'))
 const server=createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html)}
  if(req.method==='GET'&&req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(await config(role,annotator)))}
  if(req.method==='POST'&&req.url==='/api/save'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw new Error('PAYLOAD_TOO_LARGE')}const body=JSON.parse(raw),cfg=await config(role,annotator);if(!cfg.cases.some(c=>(c.case?.id??c.id)===body.case_id))throw new Error('UNKNOWN_CASE');const path=role==='privacy'?privacyPath:role==='arbitration'?resolve(privateDir,'arbitration.json'):statePath(role);const state=await readJson(path,{});state[body.case_id]=body.answer;await atomic(path,state);res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"saved":true}')}
  res.writeHead(404);res.end('not found')
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}})
 server.listen(port,'127.0.0.1',()=>console.log(`Annotation ${role} available at http://127.0.0.1:${port}`))
}

const [command,arg1,arg2,arg3]=process.argv.slice(2)
try{
 if(command==='serve')await serve(arg1,arg2,Number(arg3||4179))
 else if(command==='freeze'&&arg1==='privacy')console.log(JSON.stringify(await freezePrivacy(arg2)))
 else if(command==='freeze'&&['A','B'].includes(arg1))console.log(JSON.stringify(await freezeAnnotation(arg1,arg2)))
 else if(command==='diff')console.log(JSON.stringify(await buildDiff()))
 else if(command==='freeze'&&arg1==='arbitration')console.log(JSON.stringify(await freezeArbitration(arg2)))
 else if(command==='validate'){const cases=await readJson(candidatesPath,[]);if(!cases.length||new Set(cases.map(c=>c.id)).size!==cases.length)throw new Error('INVALID_CANDIDATES');console.log(JSON.stringify({cases:cases.length,development:cases.filter(c=>c.split==='development').length,holdout:cases.filter(c=>c.split==='holdout').length}))}
 else if(command!=='serve')throw new Error('Usage: annotation-tool.mjs serve <privacy|A|B|arbitration> <id> [port] | freeze <privacy|A|B|arbitration> <id> | diff | validate')
}catch(error){console.error(error.message);process.exitCode=1}
