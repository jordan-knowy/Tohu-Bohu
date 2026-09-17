import {describe,it,expect,vi} from 'vitest'
import {allRows,scoreLedger} from './pipeline.ts'
import {PARAMS_V6_PALIER,REGISTRY_V6} from './registry-v6.ts'
describe('Foundation pipeline integration (mocked persistence)',()=>{
  it('paginates all rows beyond the PostgREST page limit',async()=>{
    const calls:number[]=[];const db={from:()=>{const q:any={select:()=>q,order:()=>q,range:async(a:number,b:number)=>{calls.push(a);return {data:Array.from({length:Math.min(b+1,1201)-a},(_,i)=>({id:a+i})),error:null}}};return q}}
    const rows=await allRows(db,'events','*',q=>q);expect(rows).toHaveLength(1201);expect(calls).toEqual([0,500,1000])
  })
  it('never treats read failure as empty relationship',async()=>{
    const db={rpc:vi.fn(async()=>({data:null,error:{message:'database unavailable'}}))}
    await expect(scoreLedger(db,{id:'d'},'2026-09-17',PARAMS_V6_PALIER,REGISTRY_V6)).rejects.toThrow('database unavailable')
    expect(db.rpc).toHaveBeenCalledTimes(1)
  })
  it('writes the canonical null state for an empty known dyad',async()=>{
    const db={rpc:vi.fn(async(name:string)=>({data:name==='v6_foundation_read'?{events:[],markers:[],qualities:[],roles:[]}:null,error:null}))}
    const s=await scoreLedger(db,{id:'d',organization_id:'org',collaborator_user_id:'user',contact_id:'person'},'2026-09-17',PARAMS_V6_PALIER,REGISTRY_V6)
    expect(s.score).toBeNull();expect(s.admissibility.account).toBe(false)
    expect(db.rpc).toHaveBeenLastCalledWith('v6_foundation_store',expect.objectContaining({p_kind:'snapshot',p_payload:s}))
  })
})
