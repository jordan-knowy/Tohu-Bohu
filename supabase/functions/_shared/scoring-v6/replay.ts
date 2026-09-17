import { buildRelationalState, dyadKey, type FoundationInput, type RelationalState } from './foundation.ts'
export function monthlySteps(end: Date, count: number): string[] {
  return Array.from({length:count},(_,i)=>new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-count+1+i,1)).toISOString())
}
/** Every input is a dated ledger. No present-day context accepted. */
export function replayDyadMonthly(base: Omit<FoundationInput,'at'>, months: string[]): RelationalState[] {
  if (!Array.isArray(base.events) || !Array.isArray(base.qualities) || !Array.isArray(base.roles)) throw new Error('DATED_LEDGER_REQUIRED')
  return months.map(at=>buildRelationalState({...base,at}))
}
export function withHistory(current: RelationalState, previous: RelationalState[]): RelationalState {
  if (previous.some(s=>s.scoringVersion!==current.scoringVersion || s.paramsVersion!==current.paramsVersion || s.registryVersion!==current.registryVersion || s.replayMode!==current.replayMode || dyadKey(s.entity)!==dyadKey(current.entity))) throw new Error('INCOMPATIBLE_HISTORY')
  const ordered = previous.filter(s=>s.observedAt<current.observedAt).sort((a,b)=>a.observedAt.localeCompare(b.observedAt))
  const prior = ordered.at(-1)
  const delta = prior?.admissibility.trend && current.admissibility.trend && prior.score!==null && current.score!==null ? current.score-prior.score : null
  // Aggregate calculated change only. Detailed causal allocation remains unknown;
  // never label an LLM hypothesis or signed evidence marker as points.
  return {...current,history:ordered.map(s=>({at:s.observedAt,score:s.score})),delta,
    causes:delta===null ? [] : [{kind:'calculated',cause:'total_same_version_change',points:delta}]}
}
export function computeDelta30(base: Omit<FoundationInput,'at'>, at:string): number|null {
  const previous = buildRelationalState({...base,at:new Date(Date.parse(at)-30*86400000).toISOString()})
  return withHistory(buildRelationalState({...base,at}),[previous]).delta
}
