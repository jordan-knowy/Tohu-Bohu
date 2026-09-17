import {describe,it,expect} from 'vitest'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'

const tool=resolve('evaluation/relational-intelligence/annotation-tool.mjs')
const labels=(markers:string[]=[])=>({expected_facts:['fait'],expected_markers:markers,forbidden_markers:[],expected_commitments:[],expected_roles:[],expected_direction:'indeterminable',indeterminable_fields:[]})
const run=(dir:string,...args:string[])=>JSON.parse(execFileSync('node',[tool,...args],{env:{...process.env,V6_ANNOTATION_PRIVATE_DIR:dir},encoding:'utf8'}))

describe('annotation workflow',()=>{
  it('freezes privacy, independent A/B, targeted disagreements and final Gold',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tohu-annotation-'))
    const cases=['one','two'].map((id,i)=>({id,group_id:id,split:i?'holdout':'development',origin:'human_real',privacy_reviewed:false,annotation_possible:true,case_type:'semantic_single',source_completeness:'partial',events:[],participants:[],timestamps:[],channel:'email',context_before:'',context_after:'',context_facts:[],privacy_findings:[],annotator_A:null,annotator_B:null,arbitration:null}))
    writeFileSync(join(dir,'candidates.v2.json'),JSON.stringify(cases))
    writeFileSync(join(dir,'privacy-review.json'),JSON.stringify(Object.fromEntries(cases.map(c=>[c.id,{privacy_reviewed:true,annotation_possible:true,annotation_not_possible_reason:null,source_completeness:'partial'}]))))
    expect(run(dir,'freeze','privacy','reviewer').annotatable).toBe(2)
    const state=(role:'A'|'B')=>Object.fromEntries(cases.map(c=>[c.id,{complete:true,evidence_notes:'preuve',labels:labels(role==='B'&&c.id==='one'?['S03']:[])}]))
    writeFileSync(join(dir,'annotation-A.json'),JSON.stringify(state('A')));writeFileSync(join(dir,'annotation-B.json'),JSON.stringify(state('B')))
    run(dir,'freeze','A','alice');run(dir,'freeze','B','bob')
    expect(run(dir,'diff').disagreements).toBe(1)
    writeFileSync(join(dir,'arbitration.json'),JSON.stringify({one:{complete:true,labels:{expected_markers:[]}}}))
    const final=run(dir,'freeze','arbitration','carol');expect(final.cases).toBe(2)
    const gold=JSON.parse(readFileSync(join(dir,'gold.v1.json'),'utf8'))
    expect(gold.dataset_version).toBe('tohu-gold-v1');expect(gold.cases[0].annotator_A.id).toBe('alice');expect(gold.cases[0].annotator_B.id).toBe('bob');expect(gold.cases.find((c:any)=>c.id==='one').arbitration.disagreements).toEqual(['expected_markers'])
  })
})
