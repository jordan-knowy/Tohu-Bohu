import {describe,it,expect} from 'vitest'
import {classifyObservations,parseObservations} from '../../../../supabase/functions/_shared/scoring-v6/semanticObservations.ts'
const text='Le problème est grave. Je vous fais confiance pour le résoudre.'
const observation=(id:string,evidence:string)=>({type:'marker',marker_candidate:id,actor:null,target:null,evidence,confidence:.9,voluntariness:'unknown',conditions:[],identity_quality:'unknown'})
const input={text,sourceEventId:'event',model:'test-model',registryVersion:'reg-v6.0',at:'2026-09-17'}
describe('Structured semantic observations',()=>{
  it('preserves multiple positive/negative observations as candidates without scoring',async()=>{const r=await classifyObservations(input,async()=>({observations:[observation('S03','Le problème est grave.'),observation('S08','Je vous fais confiance pour le résoudre.')],abstained:false}));expect(r.result_status).toBe('candidate');expect(r.observations).toHaveLength(2);expect(r.model).toBe('test-model');expect(r.prompt_version).toBeDefined()})
  it('network failure is technical_error, never no_marker',async()=>{const r=await classifyObservations(input,async()=>{throw new Error('offline')});expect(r.result_status).toBe('technical_error');expect(r.abstained).toBe(false)})
  it('invalid JSON/schema is technical_error',async()=>expect((await classifyObservations(input,async()=>null)).result_status).toBe('technical_error'))
  it('explicit abstention is no_marker',async()=>expect((await classifyObservations(input,async()=>({observations:[],abstained:true}))).result_status).toBe('no_marker'))
  it('rejects invented quotes and unknown markers',()=>{for(const o of [observation('UNKNOWN','Le problème est grave.'),observation('S03','Citation totalement inventée')])expect(()=>parseObservations({observations:[o],abstained:false},text)).toThrow()})
  it('rejects a score produced by the LLM',()=>expect(()=>parseObservations({observations:[],abstained:false,score:67},text)).toThrow('INVALID_SCHEMA'))
  it('source unavailable is not an empirical negative',async()=>expect((await classifyObservations({...input,text:''},async()=>({}))).result_status).toBe('technical_error'))
})
