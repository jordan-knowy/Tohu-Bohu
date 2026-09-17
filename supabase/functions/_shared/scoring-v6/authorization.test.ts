import {describe,it,expect,vi} from 'vitest'
import {authorizeFoundationRequest,type AuthorizationPorts} from './authorization.ts'
const scope={organizationId:'org',contactId:'contact'}
const request=(headers:Record<string,string>={})=>new Request('https://local.test',{headers})
const ports=():AuthorizationPorts=>({serviceKey:'real-server-secret',cronSecret:vi.fn(async()=> 'real-cron-secret'),verifyUser:vi.fn(async(token)=>token==='valid-user'?'user':null),isMember:vi.fn(async()=>true),canReadContact:vi.fn(async()=>true)})
describe('Foundation authorization',()=>{
  it('anonymous denied before any organizational query',async()=>{const p=ports();await expect(authorizeFoundationRequest(request(),scope,p)).rejects.toThrow('UNAUTHORIZED');expect(p.isMember).not.toHaveBeenCalled();expect(p.canReadContact).not.toHaveBeenCalled()})
  it('same-org user with visible contact accepted',async()=>{expect(await authorizeFoundationRequest(request({Authorization:'Bearer valid-user'}),scope,ports())).toEqual({kind:'user',userId:'user'})})
  it('other-org user rejected before contact access',async()=>{const p=ports();p.isMember=vi.fn(async()=>false);await expect(authorizeFoundationRequest(request({Authorization:'Bearer valid-user'}),scope,p)).rejects.toThrow('FORBIDDEN');expect(p.canReadContact).not.toHaveBeenCalled()})
  it('restricted visibility denied',async()=>{const p=ports();p.canReadContact=vi.fn(async()=>false);await expect(authorizeFoundationRequest(request({Authorization:'Bearer valid-user'}),scope,p)).rejects.toThrow('FORBIDDEN')})
  it('legitimate cron authenticated by secret',async()=>{const p=ports();expect(await authorizeFoundationRequest(request({'x-cron-secret':'real-cron-secret'}),{},p)).toEqual({kind:'service',userId:null});expect(p.isMember).not.toHaveBeenCalled()})
  it('forged service-role JWT is not authentication',async()=>{const forged='e30.'+btoa(JSON.stringify({role:'service_role'}))+'.forged';await expect(authorizeFoundationRequest(request({Authorization:`Bearer ${forged}`}),scope,ports())).rejects.toThrow('UNAUTHORIZED')})
  it('configured service credential accepted; missing/empty credentials never authenticate',async()=>{expect((await authorizeFoundationRequest(request({Authorization:'Bearer real-server-secret'}),{},ports())).kind).toBe('service');const p=ports();p.serviceKey=undefined;await expect(authorizeFoundationRequest(request(),scope,p)).rejects.toThrow('UNAUTHORIZED')})
  it('wrong cron secret does not bypass auth',async()=>{await expect(authorizeFoundationRequest(request({'x-cron-secret':'bad'}),scope,ports())).rejects.toThrow('UNAUTHORIZED')})
})
