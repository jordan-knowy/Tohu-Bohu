/** Authentication adapter. Never decodes JWTs; user JWTs are verified by auth.getUser. */
export interface AuthorizationPorts {
  serviceKey: string | undefined
  cronSecret(): Promise<string|null>
  verifyUser(token:string): Promise<string|null>
  isMember(userId:string,organizationId:string): Promise<boolean>
  canReadContact(userId:string,organizationId:string,contactId:string): Promise<boolean>
}
export type Principal = {kind:'service';userId:null}|{kind:'user';userId:string}
export async function authorizeFoundationRequest(req: Request, scope: {organizationId?:string|null;contactId?:string|null}, ports:AuthorizationPorts): Promise<Principal> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /,'')
  // Possession of the configured server credential, not a self-asserted JWT claim.
  if (ports.serviceKey && token === ports.serviceKey) return {kind:'service',userId:null}
  const supplied = req.headers.get('x-cron-secret')
  if (supplied) { const expected = await ports.cronSecret(); if (expected && supplied===expected) return {kind:'service',userId:null} }
  if (!token) throw new Error('UNAUTHORIZED')
  const userId = await ports.verifyUser(token)
  if (!userId) throw new Error('UNAUTHORIZED')
  if (!scope.organizationId || !await ports.isMember(userId,scope.organizationId)) throw new Error('FORBIDDEN')
  // Manual classification requires an explicit visible contact. No unrestricted org scans.
  if (!scope.contactId || !await ports.canReadContact(userId,scope.organizationId,scope.contactId)) throw new Error('FORBIDDEN')
  return {kind:'user',userId}
}
export async function authorizeWithClients(req:Request, scope:{organizationId?:string|null;contactId?:string|null}, admin:any, user:any, serviceKey:string|undefined) {
  return authorizeFoundationRequest(req,scope,{
    serviceKey,
    cronSecret:async()=>{ const r=await admin.from('app_secrets').select('value').eq('name','monitor_cron').maybeSingle(); if(r.error) throw r.error; return r.data?.value ?? null },
    verifyUser:async token=>{const r=await user.auth.getUser(token); return r.error ? null : r.data?.user?.id ?? null},
    isMember:async (uid,org)=>{const r=await user.from('memberships').select('id').eq('user_id',uid).eq('organization_id',org).maybeSingle(); return !r.error && !!r.data},
    canReadContact:async (_uid,org,id)=>{const r=await user.from('contacts').select('id').eq('id',id).eq('organization_id',org).maybeSingle(); return !r.error && !!r.data},
  })
}
