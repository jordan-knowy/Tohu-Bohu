// Audit only: synthetic counterexamples, no DB/API access and no scoring changes.
// Run from the repository root: node docs/audits/v6-phase0-repro.mjs
import { build } from 'esbuild'
const compiled = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { calculateDyadScoreCore } from './src/services/scoring/calculateDyadScoreCore'
import { buildDyadScoreSnapshot } from './src/services/scoring/snapshots'
import { replayDyadMonthly } from './src/services/scoring/replay'
import { detectA01, detectS04 } from './src/services/scoring/detectors'
import { calculateAccountWeatherCore } from './src/services/scoring/calculateAccountWeatherCore'
import { REGISTRY_V6, PARAMS_V6_PALIER } from './src/services/scoring/registry-v6'
const role = {label:'Non qualifié', volontariteProfile:'standard'} as const
const event = (sense: -1|1) => ({markerId:'R01',sense,observedAt:'2026-08-01T00:00:00Z',evidenceRef:String(sense)})
const score = (events: any[]) => calculateDyadScoreCore(events,role,PARAMS_V6_PALIER,REGISTRY_V6)
const base = {role,params:PARAMS_V6_PALIER,registry:REGISTRY_V6,
  context:{ageDays:100,episodes:10,daysSinceLast:1,cadenceMedian:5,hasX02:false},
  reliabilityInputs:{channelCoverage:1,identityResolution:1,diarizationQuality:1,hasX01:false}}
const empty = buildDyadScoreSnapshot({...base,markerEvents:[],at:'2026-09-17T00:00:00Z'})
const ancient = buildDyadScoreSnapshot({...base,markerEvents:[{markerId:'S07',sense:-1,observedAt:'2020-01-01T00:00:00Z',evidenceRef:'synthetic'}],at:'2026-09-17T00:00:00Z'})
const unknown = buildDyadScoreSnapshot({...base,markerEvents:Array.from({length:5},(_,i)=>({markerId:'UNKNOWN',sense:1,observedAt:'2026-08-01T00:00:00Z',evidenceRef:String(i)})),at:'2026-09-17T00:00:00Z'})
const now = Date.parse('2026-09-17T00:00:00Z')
const futureMeeting = detectA01([{id:'m',threadId:'t',direction:'inbound',sentAt:'2026-09-16T00:00:00Z'}],[{id:'future',startsAt:'2026-10-01T00:00:00Z',occurred:false,contactParticipated:false}],now)
let replay: unknown
try { replay = replayDyadMonthly({...base,markerEvents:[]} as any,['2026-08-01T00:00:00Z']) } catch(e) { replay = {rejected: (e as Error).message} }
const noEvidenceAccount = calculateAccountWeatherCore({relationType:'Client/Prospect',activeDyads:[],coverage:{targets:[{role:'utilisateur',authority:0.3,covered:false,isDecider:false,relationalLevel:0}]},equilibreShares:[],carriers:1,kEvents:[],dynamics:{delta30OtherDials:0,daysSinceLast:0,cadenceMedian:0,engagementsHeld:0,engagementsSlipped:0},at:'2026-09-17T00:00:00Z'},PARAMS_V6_PALIER,REGISTRY_V6)
console.log(JSON.stringify({
  note:'Observations of CURRENT code; Phase 0 baseline is archived in v6-phase0-repro-results.json. NOT human-annotated gold data.',
  oppositeOrder:{positiveFirst:score([event(1),event(-1)]).axes.reciprocite.value,negativeFirst:score([event(-1),event(1)]).axes.reciprocite.value},
  matureWithoutMarkers:{score:empty.score,reliability:empty.reliability,verdictAllowed:empty.verdictAllowed,passesBatchActiveFilter:!empty.coldStart&&!!empty.core},
  sixYearOldCriticalMarker:{satisfaction:ancient.core?.axes.satisfaction.value,capped:ancient.core?.axes.satisfaction.cappedByS07},
  unknownMarkers:{score:unknown.score,count:unknown.markerCount,verdictAllowed:unknown.verdictAllowed},
  futureMeetingCountsAsChannel:futureMeeting,
  replayWithPresentDayContext:replay,
  accountWithOwnerAndUncontactedContact:{score:noEvidenceAccount.score,dynamics:noEvidenceAccount.dials.d_dynamique.value},
},null,2))
` },
  bundle: true, write: false, platform: 'node', format: 'esm',
})
await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
