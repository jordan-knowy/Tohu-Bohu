import {describe,it,expect} from 'vitest'
import {evaluate,validateDataset,type GoldCase,type Labels,type Prediction} from './harness'
const labels:Labels={expected_facts:[],expected_markers:['C01'],forbidden_markers:['S07','K06'],expected_commitments:[],expected_roles:[],expected_direction:'up',indeterminable_fields:[]}
const c:GoldCase={id:'unit-test-only',group_id:'relation',split:'development',origin:'synthetic_template',events:[],participants:[],timestamps:[],channel:'email',context_before:'',context_after:'',annotator_A:{id:'test-A',labels},annotator_B:{id:'test-B',labels},arbitration:{id:'test-arbitrator',labels,disagreements:[]}}
const p:Prediction={case_id:c.id,markers:['C01','S07'],abstained:false,technical_error:false,model:'fixture',prompt_version:'v1',classifier_version:'v1',registry_version:'v1'}
describe('Evaluation harness (synthetic unit fixtures, not human gold)',()=>{
  it('reports per-marker counts including critical false positives',()=>{const r=evaluate([c],[p],{split:'development',allowSynthetic:true});expect(r.perMarker.C01?.precision).toBe(1);expect(r.perMarker.S07?.fp).toBe(1);expect(r.perMarker.S07?.forbidden).toBe(1);expect(r.perMarker.K06?.precision).toBeNull();expect(r.gold).toBe(false)})
  it('synthetic cases excluded from human metrics by default',()=>expect(evaluate([c],[p],{split:'development'}).evaluated).toBe(0))
  it('detects account/relation leakage across splits',()=>expect(()=>validateDataset([c,{...c,id:'other',split:'holdout'}])).toThrow('HOLDOUT_LEAKAGE'))
  it('requires two annotations and arbitration',()=>expect(evaluate([{...c,arbitration:null}],[p],{split:'development',allowSynthetic:true}).evaluated).toBe(0))
  it('keeps abstention and technical error rates separate; expected markers remain FN',()=>{const r=evaluate([c],[{...p,markers:[],abstained:true}],{split:'development',allowSynthetic:true});expect(r.abstention_rate).toBe(1);expect(r.technical_error_rate).toBe(0);expect(r.perMarker.C01?.fn).toBe(1);expect(evaluate([c],[],{split:'development',allowSynthetic:true}).technical_error_rate).toBe(1)})
  it('duplicate predictions cannot silently overwrite a result',()=>expect(()=>evaluate([c],[p,p],{split:'development',allowSynthetic:true})).toThrow('DUPLICATE_PREDICTION'))
  it('rejects mixed experiment versions',()=>expect(()=>evaluate([c,{...c,id:'two',group_id:'two'}],[p,{...p,case_id:'two',model:'other'}],{split:'development',allowSynthetic:true})).toThrow('MIXED_EXPERIMENT_VERSIONS'))
})
