export interface Labels {
  expected_facts:string[];expected_markers:string[];forbidden_markers:string[];expected_commitments:string[];expected_roles:string[]
  expected_direction:'up'|'stable'|'down'|'indeterminable';indeterminable_fields:string[]
}
export interface GoldCase {
  id:string;group_id:string;split:'development'|'holdout';origin:'human_real'|'synthetic_template'
  privacy_reviewed?:boolean
  events:unknown[];participants:unknown[];timestamps:string[];channel:string;context_before:string;context_after:string
  annotator_A:{id:string;labels:Labels}|null;annotator_B:{id:string;labels:Labels}|null
  arbitration:{id:string;labels:Labels;disagreements:string[]}|null
}
export interface Prediction {case_id:string;markers:string[];facts?:string[];commitments?:string[];roles?:string[];direction?:Labels['expected_direction'];abstained:boolean;technical_error:boolean;model:string;prompt_version:string;classifier_version:string;registry_version:string;dataset_version:string}
export function validateDataset(cases:GoldCase[]):void {
  const groups=new Map<string,string>(),ids=new Set<string>()
  for(const c of cases){
    if(!c.id || ids.has(c.id) || !c.group_id || !['development','holdout'].includes(c.split) || !['human_real','synthetic_template'].includes(c.origin))throw new Error('INVALID_CASE')
    ids.add(c.id)
    if(groups.has(c.group_id)&&groups.get(c.group_id)!==c.split)throw new Error('HOLDOUT_LEAKAGE')
    groups.set(c.group_id,c.split)
    if(!Array.isArray(c.events)||!Array.isArray(c.participants)||!Array.isArray(c.timestamps)||c.timestamps.some(t=>!Number.isFinite(Date.parse(t)))||typeof c.channel!=='string'||typeof c.context_before!=='string'||typeof c.context_after!=='string')throw new Error('INVALID_CONTEXT')
    for(const a of [c.annotator_A,c.annotator_B,c.arbitration])if(a){
      if(!a.id || !a.labels || !['up','stable','down','indeterminable'].includes(a.labels.expected_direction))throw new Error('INVALID_ANNOTATION')
      for(const key of ['expected_facts','expected_markers','forbidden_markers','expected_commitments','expected_roles','indeterminable_fields'] as const)if(!Array.isArray(a.labels[key])||!a.labels[key].every(x=>typeof x==='string'))throw new Error('INVALID_ANNOTATION')
      if(a.labels.expected_markers.some(x=>a.labels.forbidden_markers.includes(x)))throw new Error('CONTRADICTORY_LABELS')
    }
    if(c.annotator_A&&c.annotator_B&&c.annotator_A.id===c.annotator_B.id)throw new Error('ANNOTATORS_NOT_INDEPENDENT')
  }
}
export function evaluate(cases:GoldCase[],predictions:Prediction[],opts:{split:'development'|'holdout';allowSynthetic?:boolean}) {
  validateDataset(cases)
  const eligible=cases.filter(c=>c.split===opts.split && (opts.allowSynthetic||(c.origin==='human_real'&&c.privacy_reviewed===true)) && c.annotator_A && c.annotator_B && c.arbitration)
  const byId=new Map<string,Prediction>()
  for(const p of predictions){if(byId.has(p.case_id))throw new Error('DUPLICATE_PREDICTION');if(!Array.isArray(p.markers)||!p.markers.every(m=>typeof m==='string')||typeof p.abstained!=='boolean'||typeof p.technical_error!=='boolean'||(!p.model||!p.prompt_version||!p.classifier_version||!p.registry_version||!p.dataset_version))throw new Error('INVALID_PREDICTION');for(const k of ['facts','commitments','roles'] as const)if(p[k]&&!p[k]!.every(x=>typeof x==='string'))throw new Error('INVALID_PREDICTION');if(p.direction&&!['up','stable','down','indeterminable'].includes(p.direction))throw new Error('INVALID_PREDICTION');if((p.abstained||p.technical_error)&&(p.markers.length||(p.facts?.length??0)||(p.commitments?.length??0)||(p.roles?.length??0)||p.direction))throw new Error('INCONSISTENT_PREDICTION');byId.set(p.case_id,p)}
  const versions=new Set(eligible.flatMap(c=>{const p=byId.get(c.id);return p?[JSON.stringify([p.model,p.prompt_version,p.classifier_version,p.registry_version,p.dataset_version])]:[]}))
  if(versions.size>1)throw new Error('MIXED_EXPERIMENT_VERSIONS')
  const counts=new Map<string,{tp:number;fp:number;fn:number;forbidden:number}>()
  for(const id of ['S07','K06'])counts.set(id,{tp:0,fp:0,fn:0,forbidden:0})
  const semantic={facts:{tp:0,fp:0,fn:0},commitments:{tp:0,fp:0,fn:0},roles:{tp:0,fp:0,fn:0}}
  let abstentions=0,errors=0,directionCorrect=0,directionEvaluated=0,annotationDisagreements=0
  for(const c of eligible){
    const p=byId.get(c.id),labels=c.arbitration!.labels
    annotationDisagreements+=c.arbitration!.disagreements.length
    if(!p||p.technical_error)errors++
    if(p?.abstained)abstentions++
    const actual=new Set(p?.markers ?? []),expected=new Set(labels.expected_markers)
    for(const m of new Set([...actual,...expected,...labels.forbidden_markers])){
      const n=counts.get(m)??{tp:0,fp:0,fn:0,forbidden:0}
      if(actual.has(m)&&expected.has(m))n.tp++
      if(actual.has(m)&&!expected.has(m))n.fp++
      if(!actual.has(m)&&expected.has(m))n.fn++
      if(actual.has(m)&&labels.forbidden_markers.includes(m))n.forbidden++
      counts.set(m,n)
    }
    for(const [kind,expectedKey] of [['facts','expected_facts'],['commitments','expected_commitments'],['roles','expected_roles']] as const){
      const predicted=new Set(p?.[kind]??[]),expectedValues=new Set(labels[expectedKey])
      for(const value of new Set([...predicted,...expectedValues])){if(predicted.has(value)&&expectedValues.has(value))semantic[kind].tp++;else if(predicted.has(value))semantic[kind].fp++;else semantic[kind].fn++}
    }
    if(p?.direction){directionEvaluated++;if(p.direction===labels.expected_direction)directionCorrect++}
  }
  const divide=(n:number,d:number)=>d?n/d:null
  const perMarker=Object.fromEntries([...counts].sort(([a],[b])=>a.localeCompare(b)).map(([marker,n])=>[marker,{...n,precision:divide(n.tp,n.tp+n.fp),recall:divide(n.tp,n.tp+n.fn),F1:divide(2*n.tp,2*n.tp+n.fp+n.fn),critical:['S07','K06'].includes(marker)}]))
  const semanticMetrics=Object.fromEntries(Object.entries(semantic).map(([kind,n])=>[kind,{...n,precision:divide(n.tp,n.tp+n.fp),recall:divide(n.tp,n.tp+n.fn),F1:divide(2*n.tp,2*n.tp+n.fp+n.fn)}]))
  return {evaluated:eligible.length,excluded:cases.length-eligible.length,split:opts.split,gold:!opts.allowSynthetic,perMarker,semantic:semanticMetrics,direction_accuracy:divide(directionCorrect,directionEvaluated),abstention_rate:divide(abstentions,eligible.length),technical_error_rate:divide(errors,eligible.length),annotation_disagreements:annotationDisagreements,experiment:[...versions][0]??null}
}
