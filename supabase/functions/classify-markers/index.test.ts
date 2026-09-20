import {beforeEach,describe,it,expect,vi} from 'vitest'
const h=vi.hoisted(()=>({handler:null as any,admin:null as any,user:null as any,member:true,visible:true,verified:true,rpcs:[] as any[]}))
vi.mock('https://esm.sh/@supabase/supabase-js@2',()=>({createClient:(_url:string,key:string)=>key==='service-secret'?h.admin:h.user}))
function query(data:unknown){const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data,error:null})};return q}
beforeEach(async()=>{
  vi.resetModules();h.member=true;h.visible=true;h.verified=true;h.rpcs=[]
  h.admin={from:vi.fn((table:string)=>{if(table==='llm_model_config')return query(null);if(table!=='app_secrets')throw new Error('UNEXPECTED_ADMIN_READ');return query({value:'cron-secret'})}),rpc:vi.fn(async(name:string,args:any)=>{
    h.rpcs.push({name,args})
    if(name==='v6_foundation_checkpoint')return {data:{},error:null}
    if(name==='v6_foundation_find')return {data:[{id:'dyad',organization_id:'org',contact_id:'contact',collaborator_user_id:'user'}],error:null}
    if(name==='v6_foundation_read')return {data:{events:[{id:'event',recordedAt:'2026-01-01',effectiveFrom:'2026-01-01',eventTime:'2026-01-01',state:'observed',evidenceText:'Une citation exacte de test.'}]},error:null}
    return {data:null,error:null}
  })}
  h.user={auth:{getUser:vi.fn(async(token:string)=>({data:{user:h.verified&&token==='valid'?{id:'user'}:null},error:null}))},from:vi.fn((table:string)=>query(table==='memberships'?(h.member?{id:'m'}:null):(h.visible?{id:'contact'}:null)))}
  const env:Record<string,string>={SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'service-secret',SUPABASE_ANON_KEY:'anon',OPENROUTER_API_KEY:'test'}
  vi.stubGlobal('Deno',{env:{get:(name:string)=>env[name]},serve:(handler:any)=>h.handler=handler})
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({observations:[],abstained:true})}}]}))))
  await import('./index')
})
const call=(authorization?:string,body:any={organizationId:'org',contactId:'contact'},extra:Record<string,string>={})=>h.handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{}),...extra},body:JSON.stringify(body)}))
describe('Classifier handler authorization and audited outcomes',()=>{
  it('anonymous cannot reach service-role data or model',async()=>{expect((await call()).status).toBe(401);expect(h.rpcs).toEqual([]);expect(fetch).not.toHaveBeenCalled()})
  it('different organization cannot reach service-role data',async()=>{h.member=false;expect((await call('Bearer valid')).status).toBe(403);expect(h.rpcs).toEqual([])})
  it('restricted visibility cannot reach service-role data',async()=>{h.visible=false;expect((await call('Bearer valid')).status).toBe(403);expect(h.rpcs).toEqual([])})
  it('visible contact binds server query to org, collaborator and contact',async()=>{expect((await call('Bearer valid')).status).toBe(200);expect(h.rpcs.find(r=>r.name==='v6_foundation_find').args).toMatchObject({p_organization_id:'org',p_contact_id:'contact',p_collaborator_id:'user'});expect(h.rpcs.find(r=>r.name==='v6_foundation_store').args.p_payload.result_status).toBe('no_marker')})
  it('legitimate cron authenticates and advances durable cursor',async()=>{expect((await call(undefined,{}, {'x-cron-secret':'cron-secret'})).status).toBe(200);expect(h.rpcs.at(-1).args).toMatchObject({p_worker:'classify',p_cursor:{after:'dyad',eventOffset:0}})})
  it('forged service claim rejected before any privileged data read',async()=>{expect((await call('Bearer e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake')).status).toBe(401);expect(h.rpcs).toEqual([])})
  it('network error persists technical_error rather than NO_MARKER',async()=>{vi.mocked(fetch).mockRejectedValue(new Error('offline'));const response=await call('Bearer valid');expect(await response.json()).toMatchObject({technical_errors:1});expect(h.rpcs.find(r=>r.name==='v6_foundation_store').args.p_payload.result_status).toBe('technical_error')})
  it('persistence error is surfaced rather than silently advancing',async()=>{const rpc=h.admin.rpc;h.admin.rpc=async(name:string,args:any)=>name==='v6_foundation_store'?{error:{message:'write failed'}}:rpc(name,args);expect((await call('Bearer valid')).status).toBe(500)})
})
