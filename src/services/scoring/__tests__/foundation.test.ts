import {describe,it,expect} from 'vitest'
import {buildRelationalState,commitmentOutcome,dyadKey,eligibleAccountDyads,type FoundationInput} from '../foundation'
import * as server from '../../../../supabase/functions/_shared/scoring-v6/foundation.ts'
import {calculateDyadScoreCore} from '../calculateDyadScoreCore'
import {calculateDyadScoreCore as serverCore} from '../../../../supabase/functions/_shared/scoring-v6/calculateDyadScoreCore.ts'
import {calculateAccountWeatherCore} from '../calculateAccountWeatherCore'
import {calculateAccountWeatherCore as serverAccount} from '../../../../supabase/functions/_shared/scoring-v6/calculateAccountWeatherCore.ts'
import {PARAMS_V6_PALIER as params,REGISTRY_V6 as registry} from '../registry-v6'
import {detectA01} from '../detectors'
import {normalizeMeeting,normalizeMessage,resolveUniqueIdentity} from '../adapters'
import {computeDelta30,replayDyadMonthly,withHistory} from '../replay'
import {detectNormalizedEvents} from '../../../../supabase/functions/_shared/scoring-v6/pipeline.ts'
const at='2026-09-17T00:00:00Z',start='2026-07-01T00:00:00Z'
const dyad={organizationId:'org',collaboratorUserId:'a',contactId:'x'}
export function fixture():FoundationInput {
  const events=Array.from({length:8},(_,i)=>{
    const date=new Date(Date.parse(start)+i*10*86400000).toISOString()
    return {id:`e${i}`,dyad,accountId:'account',sourceEventId:`source${i}`,sourceType:'message',channel:'email',eventTime:date,ingestedAt:date,recordedAt:date,effectiveFrom:date,state:'observed' as const,internalActorId:'a',externalActorId:'x',participants:['a','x'],ownerUserId:'a',evidenceRef:`proof${i}`,evidenceUnitId:`unit${i}`,identityQuality:'verified' as const,completeness:'complete' as const,sourceVersion:'v1',participationObserved:true,direction:'inbound' as const,threadId:'thread'}
  })
  const ids=['C01','S08','E01','R01','A01','C04','S08','E01']
  return {dyad,at,computedAt:at,params,registry,events,
    markers:events.map((e,i)=>({id:`m${i}`,dyad,markerId:ids[i]!,sense:1 as const,observedAt:e.eventTime,recordedAt:e.recordedAt,effectiveFrom:e.eventTime,sourceEventIds:[e.id],state:'active' as const,status:'accepted' as const,registryVersion:registry.version,detectorVersion:'fixture',voluntariness:'unknown' as const,intensity:'unknown' as const})),
    qualities:[{id:'q',recordedAt:start,effectiveFrom:start,reliability:0.8,reliabilityEvidence:['human-validation-run'],identity:'verified',diarization:'verified',completeness:'complete',expectedChannels:['email'],observedChannels:['email'],periodStart:start,periodEnd:start}],
    roles:[{id:'r',recordedAt:start,effectiveFrom:start,origin:'declared',role:{label:'Direction',volontariteProfile:'standard'},authority:1,evidence:['manual-role']}]}
}
const build=(patch:Partial<FoundationInput>={})=>buildRelationalState({...fixture(),...patch})
function shuffle<T>(a:T[],seed:number):T[]{const b=[...a];for(let i=b.length-1;i>0;i--){seed=(seed*1664525+1013904223)>>>0;const j=seed%(i+1);[b[i],b[j]]=[b[j]!,b[i]!]}return b}
describe('Phase 1 properties and shared-server parity',()=>{
  it('permutation invariant over 250 independent permutations, including all serialized contributions',()=>{
    const f=fixture(),expected=buildRelationalState(f)
    expect(expected.score).not.toBeNull()
    for(let seed=1;seed<=250;seed++)expect(buildRelationalState({...f,events:shuffle(f.events,seed),markers:shuffle(f.markers,seed+1)})).toEqual(expected)
  })
  it('equal opposite magnitudes share rank mass, no sign preference (56/44 → 50/50)',()=>{
    const ev=[1,-1].map(sense=>({markerId:'R01',sense:sense as 1|-1,observedAt:at,evidenceRef:String(sense)})),role=fixture().roles[0]!.role!
    const run=(e:typeof ev)=>calculateDyadScoreCore(e,role,params,registry)
    expect(run(ev)).toEqual(run([...ev].reverse()))
    expect(run(ev).axes.reciprocite.value).toBe(50)
    expect(run(ev).axes.reciprocite.contributions.map(c=>c.decayMultiplier)).toEqual([0.85,0.85])
  })
  it('idempotence across repeated event and marker ingestion',()=>{const f=fixture();expect(build({...f,events:[...f.events,...f.events],markers:[...f.markers,...f.markers]})).toEqual(build(f))})
  it('repetition uses independent units, not duplicate interpretations',()=>{
    const e={markerId:'C01',sense:1 as const,observedAt:at,evidenceRef:'one',evidenceUnitId:'same-event'},role=fixture().roles[0]!.role!
    const a=calculateDyadScoreCore([e],role,params,registry),b=calculateDyadScoreCore([e,{...e,evidenceRef:'two'}],role,params,registry)
    expect(a.score).toBe(b.score);expect(b.axes.confiance.contributions[0]!.occurrences).toBe(1)
  })
  it('no markers means no observable score or account eligibility',()=>{const s=build({markers:[]});expect(s.score).toBeNull();expect(s.status).toBe('insufficient_evidence');expect(eligibleAccountDyads([s])).toEqual([])})
  it('5 UNKNOWN markers cannot unlock P7',()=>{const f=fixture();const s=build({markers:f.markers.slice(0,5).map(m=>({...m,markerId:'UNKNOWN'}))});expect(s.score).toBeNull();expect(s.admissibility.verdict).toBe(false);expect(s.evidence).toEqual([]);expect(s.errors).toContain('UNKNOWN_OR_INVALID_MARKER:UNKNOWN')})
  it.each(['unknown','ambiguous','inferred'] as const)('identity %s never becomes authoritative',identityQuality=>{const f=fixture();expect(build({events:f.events.map(e=>({...e,identityQuality}))}).score).toBeNull()})
  it('unknown qualities remain null, without coefficients invented from categories',()=>{const s=build({qualities:[]});expect(s.reliability).toBeNull();expect(s.coverage.value).toBeNull();expect(s.score).toBeNull()})
  it('reliability zero excludes account and verdict',()=>{const f=fixture();const s=build({qualities:f.qualities.map(q=>({...q,reliability:0}))});expect(s.admissibility.verdict).toBe(false);expect(eligibleAccountDyads([s])).toEqual([])})
  it('unknown role is not user authority .3; inferred does not replace declared',()=>{const f=fixture();const s=build({roles:f.roles.map(r=>({...r,origin:'inferred'}))});expect(s.authority).toBeNull();expect(s.declaredRole).toBeNull();expect(s.inferredRole).not.toBeNull();expect(s.score).toBeNull()})
  it('all quality dimensions are required for admission',()=>{const f=fixture();expect(build({qualities:f.qualities.map(q=>({...q,completeness:'partial'}))}).admissibility.display).toBe(false)})
  it('collaborator is part of identity; another collaborator changes no state',()=>{const f=fixture(),other={...dyad,collaboratorUserId:'b'};expect(dyadKey(other)).not.toBe(dyadKey(dyad));expect(build({events:[...f.events,...f.events.map(e=>({...e,dyad:other}))]})).toEqual(build(f))})
  it('every contribution traces to admitted event units and marker evidence',()=>{const f=fixture(),s=build(f);for(const c of s.contributions){expect(c.evidenceUnitIds.length).toBeGreaterThan(0);for(const ref of c.evidenceRefs){const m=f.markers.find(m=>m.id===ref)!;expect(m).toBeDefined();for(const id of m.sourceEventIds)expect(s.evidence.some(e=>e.id===id)).toBe(true)}}})
  it('many overlapping interpretations cannot inflate independent P7 count',()=>{
    const f=fixture();const s=build({markers:f.markers.map(m=>({...m,sourceEventIds:f.events.map(e=>e.id),observedAt:at}))})
    expect(s.admissibility.verdict).toBe(false)
    expect(s.admissibility.reasons).toContain('INSUFFICIENT_INDEPENDENT_EVIDENCE')
  })
  it('invalid marker timestamps cannot bypass admission',()=>{
    const f=fixture();expect(build({markers:f.markers.map(m=>({...m,observedAt:'invalid'}))}).score).toBeNull()
  })
  it('unknown qualities are not replaced by defaults even on all-axis evidence',()=>{
    const f=fixture();expect(build({qualities:f.qualities.map(q=>({...q,reliability:null}))}).reliability).toBeNull()
  })
  it('critical markers need explicit validation and a checked source quote',()=>{
    const f=fixture();const s=build({markers:[{...f.markers[1]!,markerId:'S07'}]})
    expect(s.score).toBeNull();expect(s.errors).toContain('UNVALIDATED_CRITICAL_EVIDENCE:m1')
  })
  it('future markers, including unknown IDs, do not affect present state',()=>{
    const f=fixture();expect(build({markers:[...f.markers,{...f.markers[0]!,id:'future',markerId:'UNKNOWN',observedAt:'2027-01-01',effectiveFrom:'2027-01-01'}]})).toEqual(build(f))
  })
  it('server and frontend are the same function and same outputs across corpus',()=>{
    expect(server.buildRelationalState).toBe(buildRelationalState);expect(serverCore).toBe(calculateDyadScoreCore);expect(serverAccount).toBe(calculateAccountWeatherCore)
    for(const patch of [{},{markers:[]},{roles:[]},{qualities:[]}])expect(server.buildRelationalState({...fixture(),...patch})).toEqual(build(patch))
  })
})
describe('Bitemporal replay and lifecycle',()=>{
  it('post-T events, markers, role and quality revisions have no impact at T',()=>{
    const f=fixture(),future='2027-01-01T00:00:00Z'
    expect(build({events:[...f.events,{...f.events[0]!,recordedAt:future,state:'deleted'}],markers:[...f.markers,{...f.markers[0]!,recordedAt:future,state:'obsolete'}],roles:[...f.roles,{...f.roles[0]!,recordedAt:future,role:null}],qualities:[...f.qualities,{...f.qualities[0]!,recordedAt:future,reliability:0}]})).toEqual(build(f))
  })
  it('known-at-T and current-truth recomputation explicitly differ after correction',()=>{
    const f=fixture(),later='2026-10-01T00:00:00Z',events=[...f.events,{...f.events[0]!,recordedAt:later,state:'deleted' as const}]
    expect(build({events})).toEqual(build(f))
    const corrected=build({events,mode:'historical_state_recomputed_with_current_truth',knowledgeAt:later})
    expect(corrected.evidence.some(e=>e.id==='e0')).toBe(false)
    expect(corrected.replayMode).not.toBe(build(f).replayMode)
  })
  it('a critical marker can remain active for six years, then stop after recorded repair',()=>{
    const f=fixture(),m={...f.markers[1]!,markerId:'S07',criticalValidated:true,evidenceQuote:'Incident critique attesté.',observedAt:'2020-01-01T00:00:00Z',effectiveFrom:'2020-01-01T00:00:00Z'}
    const events=f.events.map(e=>e.id==='e1'?{...e,evidenceText:'Incident critique attesté.',eventTime:'2020-01-01T00:00:00Z',effectiveFrom:'2020-01-01T00:00:00Z',ingestedAt:'2020-01-01T00:00:00Z',recordedAt:'2020-01-01T00:00:00Z'}:e)
    const s=build({events,markers:[...f.markers.filter(x=>x.id!==m.id),m]});expect(s.axes.satisfaction).toBe(20)
    const repaired=build({events,markers:[...f.markers.filter(x=>x.id!==m.id),m,{...m,recordedAt:'2026-09-16T00:00:00Z',state:'resolved',resolvedAt:'2026-09-16T00:00:00Z'}]})
    expect(repaired.axes.satisfaction).toBeGreaterThan(20)
  })
  it('replay derives age/episodes from the past, not current context',()=>{const f=fixture();const points=replayDyadMonthly(f,['2026-07-01T00:00:00Z',at]);expect(points[0]!.score).toBeNull();expect(points[0]!.status).toBe('cold_start');expect(points[1]!.score).not.toBeNull()})
  it('delta stays unknown if either bound lacks admissible evidence',()=>{const f=fixture();expect(computeDelta30({...f,qualities:f.qualities.map(q=>({...q,recordedAt:'2026-08-20T00:00:00Z'}))},at)).toBeNull()})
  it('history rejects mixed engine versions',()=>{const s=build();expect(()=>withHistory(s,[{...s,scoringVersion:'legacy'}])).toThrow('INCOMPATIBLE_HISTORY')})
  it('conflicting same-time revisions quarantine the evidence',()=>{const f=fixture();const s=build({events:[...f.events,{...f.events[0]!,state:'deleted'}]});expect(s.errors).toContain('CONFLICTING_REVISION:e0');expect(s.score).toBeNull()})
})
describe('Observed events and commitments',()=>{
  it.each(['scheduled','cancelled','deleted','corrected'] as const)('%s is not observed',state=>{const f=fixture();expect(build({events:f.events.map(e=>({...e,state}))}).score).toBeNull()})
  it('A01 future and cancelled meeting are not an observed channel',()=>{
    const msg=[{id:'m',threadId:'t',direction:'inbound' as const,sentAt:'2026-09-16T00:00:00Z'}]
    for(const meeting of [{id:'future',startsAt:'2027-01-01',occurred:false,contactParticipated:false},{id:'cancel',startsAt:'2026-09-16',occurred:true,contactParticipated:true,state:'cancelled' as const}])expect(detectA01(msg,[meeting],Date.parse(at))[0]!.sense).toBe(-1)
    expect(detectA01(msg,[{id:'held',startsAt:'2026-09-16',occurred:true,contactParticipated:true}],Date.parse(at))[0]!.sense).toBe(1)
  })
  it('owner plus uncontacted contact gives no account score',()=>{
    const s=calculateAccountWeatherCore({relationType:'Client/Prospect',activeDyads:[],coverage:{targets:[{role:'user',authority:.3,covered:false,isDecider:false}]},equilibreShares:[],carriers:1,kEvents:[],dynamics:{delta30OtherDials:0,daysSinceLast:0,cadenceMedian:0,engagementsHeld:0,engagementsSlipped:0}},params,registry)
    expect(s.score).toBeNull();expect(s.dials.d_dynamique.value).toBeNull()
  })
  it('normalized detection never mixes collaborators and traces evidence',()=>{const f=fixture(),d=detectNormalizedEvents(f.events,dyad,at);expect(d.markers.length).toBeGreaterThan(0);expect(d.markers.every(m=>m.sourceEventIds.every(id=>f.events.some(e=>e.id===id)))).toBe(true);expect(detectNormalizedEvents(f.events,{...dyad,collaboratorUserId:'b'},at).markers).toEqual([])})
  it.each([
    [{dueAt:'2026-01-01',completedAt:'2026-01-02'},'held_late'],
    [{dueAt:'2026-01-02',completedAt:'2026-01-01'},'held_on_time'],
    [{resolvedAt:'2026-01-02'},'unknown'],
    [{disposition:'cancelled' as const},'cancelled'],
    [{disposition:'waived' as const},'waived'],
    [{disposition:'broken' as const},'broken'],
    [{dueAt:'2020-01-01'},'open'],
  ])('commitment status does not equate resolution with fulfilment %j',(input,expected)=>expect(commitmentOutcome(input,at)).toBe(expected))
  it('homonyms do not pick first candidate',()=>{expect(resolveUniqueIdentity(['x','y'])).toEqual({contactId:null,quality:'ambiguous'})})
  it('adapters never invent quality or meeting participation',()=>{
    expect(normalizeMessage({id:'m',organization_id:'org',contact_id:'x',metadata:{user_id:'a'},created_at:start,sent_at:start})?.identityQuality).toBe('unknown')
    expect(normalizeMeeting({id:'mt',organization_id:'org',created_at:start,starts_at:start},dyad)?.state).toBe('scheduled')
  })
})
