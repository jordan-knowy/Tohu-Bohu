import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

const DIM = { intensite: 0.40, reciprocite: 0.35, longevite: 0.25 };
const PHASE_DELTA = 8.0;
const PHASE_DECLINE_MAX = 70;
const HONEYMOON_DAYS = 45;

function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }

function decay(daysSince: number, depth: number): number {
  const hl = 30 + depth * 150;
  return Math.exp(-(Math.LN2 / hl) * daysSince);
}

function honeymoon(raw: number, age: number): number {
  if (age >= HONEYMOON_DAYS) return raw;
  return Math.min(raw, 0.45 + (age / HONEYMOON_DAYS) * 0.20);
}

function buildStats(msgs: any[], meets: any[], createdAt: string | null) {
  const now = Date.now();
  const c30 = now - 30 * 86400000;
  const c90 = now - 90 * 86400000;
  const msgs30 = msgs.filter(m => m.sent_at && new Date(m.sent_at).getTime() > c30);
  const meets90 = meets.filter(m => m.starts_at && new Date(m.starts_at).getTime() > c90);
  const outbound = msgs.filter(m => m.direction === 'outbound').length;
  const total = msgs.length || 1;
  const inbound = msgs.filter(m => m.direction === 'inbound').length;
  const tGroups = new Map<string, number>();
  for (const m of msgs) if (m.thread_id) tGroups.set(m.thread_id, (tGroups.get(m.thread_id) || 0) + 1);
  const avgDepth = tGroups.size ? Array.from(tGroups.values()).reduce((a, b) => a + b, 0) / tGroups.size : 1;
  const ageInDays = createdAt ? Math.round((now - new Date(createdAt).getTime()) / 86400000) : 0;
  const allDates = [...msgs.map(m => m.sent_at ? new Date(m.sent_at).getTime() : 0), ...meets.map(m => m.starts_at ? new Date(m.starts_at).getTime() : 0)].filter(d => d > 0);
  const lastContact = allDates.length ? Math.max(...allDates) : 0;
  const daysSince = lastContact ? Math.round((now - lastContact) / 86400000) : 999;
  const monthly: number[] = [];
  for (let i = 0; i < 6; i++) { const s = now-(i+1)*30*86400000; const e = now-i*30*86400000; monthly.push(msgs.filter(m => { const t = m.sent_at ? new Date(m.sent_at).getTime() : 0; return t>s && t<=e; }).length); }
  const qMeets = [0,1,2,3].filter(q => { const s=now-(q+1)*90*86400000; const e=now-q*90*86400000; return meets.some(m => { const t=m.starts_at?new Date(m.starts_at).getTime():0; return t>s&&t<=e; }); }).length;
  return { msgs30: msgs30.length, meets90: meets90.length, avgDepth, channels: (msgs.length>0?1:0)+(meets.length>0?1:0), initRatio: outbound/total, respRate: total>1?clamp((Math.min(inbound,outbound)*2)/total):0.3, rtRatio: 0.5, ageInDays, daysSince, monthly, qMeets, totalInter: msgs.length + meets.length*4 };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: { user }, error: ue } = await sb.auth.getUser(auth.replace('Bearer ', ''));
  if (ue || !user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { organizationId, contactId } = body;
  if (!organizationId || !contactId) return jsonResponse({ error: 'organizationId and contactId required' }, 400);
  const [{ data: contact }, { data: msgs }, { data: partRows }] = await Promise.all([
    sb.from('contacts').select('full_name, email, created_at').eq('id', contactId).single(),
    sb.from('communication_messages').select('direction, sent_at, thread_id, metadata').eq('organization_id', organizationId).eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(200),
    sb.from('meeting_participants').select('meetings(starts_at)').eq('organization_id', organizationId).eq('contact_id', contactId),
  ]);
  if (!contact) return jsonResponse({ error: 'Contact not found' }, 404);
  const meets = (partRows || []).map((p: any) => p.meetings).filter(Boolean).flat();
  const s = buildStats(msgs || [], meets, contact.created_at);
  if (s.totalInter === 0 && s.ageInDays < 30) return jsonResponse({ contactId, engagementScore: null, phase: 'stagnant', message: 'Données insuffisantes' });
  const asymm = Math.abs(s.initRatio - 0.5) * 2;
  const si = (clamp(s.msgs30/4) * 0.40 + clamp((s.meets90/90)/(1/30)) * 0.35 + (s.channels>=2?0.65:0.25) * 0.15 + clamp(s.avgDepth/5) * 0.10);
  const sr = (Math.max(0.40, 1.0-asymm*0.60) * 0.50 + clamp(s.respRate) * 0.30 + clamp(s.rtRatio/2) * 0.20);
  const lFactor = s.ageInDays < 30 ? 0 : s.ageInDays < 90 ? (s.ageInDays-30)/60 : 1.0;
  const lScore = lFactor === 0 ? 0 : (() => { const age=clamp(s.ageInDays/(24*30)); let cons=0.5; if(s.monthly.length>=3){const mn=s.monthly.reduce((a:number,b:number)=>a+b,0)/s.monthly.length; if(mn>0){const va=s.monthly.reduce((a:number,b:number)=>a+(b-mn)**2,0)/s.monthly.length; cons=Math.max(0,1-Math.sqrt(va)/mn/2);}} const mc=s.qMeets/4; return (age*0.45+cons*0.35+mc*0.20)*lFactor; })();
  const w = lFactor < 1 ? { i: DIM.intensite+DIM.longevite*(1-lFactor)*0.54, r: DIM.reciprocite+DIM.longevite*(1-lFactor)*0.46, l: DIM.longevite*lFactor } : { i: DIM.intensite, r: DIM.reciprocite, l: DIM.longevite };
  const raw = si*w.i + sr*w.r + lScore*w.l;
  const depth = clamp(s.totalInter/500);
  const finalScore = Math.round(clamp(honeymoon(raw, s.ageInDays) * decay(s.daysSince, depth)) * 100);
  const { data: prev } = await sb.from('relationship_snapshots').select('engagement_score').eq('organization_id', organizationId).eq('contact_id', contactId).order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
  const delta = finalScore - (prev?.engagement_score ?? finalScore);
  const phase = delta >= PHASE_DELTA ? 'growth' : delta <= -PHASE_DELTA && finalScore <= PHASE_DECLINE_MAX ? 'decline' : 'stagnant';
  const lastAt = s.daysSince < 999 ? new Date(Date.now()-s.daysSince*86400000).toISOString() : null;
  const today = new Date().toISOString().split('T')[0];
  await sb.from('relationship_snapshots').upsert({ organization_id: organizationId, user_id: user.id, contact_id: contactId, engagement_score: finalScore, score_evolution: delta, phase, last_contact_at: lastAt, last_contact_type: meets.length>0&&(msgs||[]).length===0?'meeting':'email', reciprocity_pct: Math.round(sr*100), avg_frequency_days: s.msgs30>0?Math.round(30/Math.max(1,s.msgs30)):null, snapshot_date: today }, { onConflict: 'organization_id,user_id,contact_id,snapshot_date' });
  if (s.daysSince > 30 && (prev?.engagement_score ?? 0) > 40) {
    const freq = s.msgs30 > 0 ? Math.round(30/s.msgs30) : 14;
    if (s.daysSince > freq * 1.5) {
      const { data: ex } = await sb.from('contact_alerts').select('alert_type').eq('organization_id', organizationId).eq('contact_id', contactId).eq('is_read', false).gte('created_at', new Date(Date.now()-7*86400000).toISOString());
      if (!(ex || []).some((a: any) => a.alert_type === 'cooling')) {
        await sb.from('contact_alerts').insert({ organization_id: organizationId, contact_id: contactId, alert_type: 'cooling', message: `Silence de ${s.daysSince} jours — cycle habituel ${freq}j` });
      }
    }
  }
  return jsonResponse({ contactId, engagementScore: finalScore, phase, delta, reciprocityPct: Math.round(sr*100), dimensions: { intensite: Math.round(si*100), reciprocite: Math.round(sr*100), longevite: Math.round(lScore*100) }, daysSinceLastContact: s.daysSince });
});
