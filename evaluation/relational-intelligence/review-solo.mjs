#!/usr/bin/env node
// Revue solo simplifiée — même corpus et mêmes définitions de marqueurs que
// annotation-tool.mjs, mais un seul rôle, un seul écran par cas (confidentialité
// + annotation fusionnées), aucun freeze/diff/arbitrage. Pensé pour une personne
// qui veut valider sa compréhension des interprétations du moteur, pas produire
// un jeu Gold statistiquement défendable (voir ANNOTATION_GUIDE.md pour ce
// protocole complet à 3 rôles, toujours disponible via annotation-tool.mjs).
import {createServer} from 'node:http'
import {readFile,rename,writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=dirname(fileURLToPath(import.meta.url)),privateDir=process.env.V6_ANNOTATION_PRIVATE_DIR?resolve(process.env.V6_ANNOTATION_PRIVATE_DIR):resolve(root,'private')
const candidatesPath=resolve(privateDir,'candidates.v2.json'),statePath=resolve(privateDir,'solo-review.json')
const readJson=async(path,fallback)=>existsSync(path)?JSON.parse(await readFile(path,'utf8')):fallback
const atomic=async(path,value)=>{const temp=path+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,path)}
// Un cas sans aucun texte (métadonnées seules : dates, sens, fil) ne peut pas être interprété par un humain.
const readable=c=>c.events.some(e=>e.text!==undefined)
const publicCase=c=>({id:c.id,case_type:c.case_type,source_completeness:c.source_completeness,events:c.events,participants:c.participants,timestamps:c.timestamps,channel:c.channel,context_before:c.context_before,context_after:c.context_after,context_facts:c.context_facts,privacy_findings:c.privacy_findings})

async function config(reviewer){
 const cases=(await readJson(candidatesPath,[])).filter(readable)
 return {reviewer,cases:cases.map(publicCase),state:await readJson(statePath,{})}
}
async function report(){
 const all=await readJson(candidatesPath,[]),cases=all.filter(readable),state=await readJson(statePath,{})
 const reviewed=cases.filter(c=>state[c.id]?.choice)
 const choices={A:0,B:0,C:0,D:0}
 for(const c of reviewed){const choice=state[c.id].choice;if(choice in choices)choices[choice]++}
 return {total:cases.length,excluded_without_text:all.length-cases.length,reviewed:reviewed.length,remaining:cases.length-reviewed.length,choice_breakdown:choices,notes:reviewed.filter(c=>state[c.id].note?.trim()).map(c=>({case_id:c.id,choice:state[c.id].choice,note:state[c.id].note}))}
}
async function serve(reviewer,port){
 if(!reviewer)throw new Error('reviewer id is required')
 const html=await readFile(resolve(root,'review-solo-app.html'))
 const server=createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html)}
  if(req.method==='GET'&&req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(await config(reviewer)))}
  if(req.method==='POST'&&req.url==='/api/save'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw new Error('PAYLOAD_TOO_LARGE')}const body=JSON.parse(raw),cfg=await config(reviewer);if(!cfg.cases.some(c=>c.id===body.case_id))throw new Error('UNKNOWN_CASE');const state=await readJson(statePath,{});state[body.case_id]={...body.answer,reviewer,reviewed_at:new Date().toISOString()};await atomic(statePath,state);res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"saved":true}')}
  res.writeHead(404);res.end('not found')
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}})
 server.listen(port,'127.0.0.1',()=>console.log(`Revue solo disponible sur http://127.0.0.1:${port} — Ctrl+C pour arrêter.`))
}

const [command,arg1,arg2]=process.argv.slice(2)
try{
 if(command==='serve')await serve(arg1,Number(arg2||4179))
 else if(command==='report')console.log(JSON.stringify(await report(),null,2))
 else throw new Error('Usage: review-solo.mjs serve <ton-nom> [port] | report')
}catch(error){console.error(error.message);process.exitCode=1}
