// account_brain — contrat UI unique (§6/§7/§8). Un appel RPC → compréhension
// exploitable, + ranking de pertinence PUR appliqué aux faits (relevance engine).
// Ne recalcule jamais le scoring. Sépare fait / inférence / calcul / synthèse.
// L'UI ne reconstruit AUCUNE logique métier : elle consomme ces DTO.

import { computeRelevance } from '../relevance/computeRelevance'
import { deriveRelevanceDimensions, type FactForRelevance, type RelationType } from '../relevance/deriveDimensions'
import type { RelevanceResult } from '../relevance/computeRelevance'

// ── Types du contrat (miroir de la sortie RPC public.account_brain) ──────────
export type Availability = 'available' | 'insufficient_data' | 'not_applicable' | 'no_personal_interaction'
export type FactKind = 'observed_fact' | 'inference' | 'deterministic' | 'synthesis'

export interface BrainFact {
  id: string; fact_type: string; title: string; detail: string | null
  impact: 'friction' | 'reinforce' | 'milestone' | 'neutral' | null
  occurred_at: string | null; first_seen_at: string
  is_overdue: boolean | null; due_window_end: string | null
  confidence: number | null; inference_level: 'fact' | 'strong_inference' | 'inferred'
  subject_contact_id: string | null; evidence_count: number; has_verbatim: boolean; kind: FactKind
}
export interface BrainRecommendation {
  id: string; category: string; title: string; justification: string; recommended_action: string | null
  priority: number; priority_breakdown: unknown; contact_id: string | null; due_at: string | null; kind: FactKind
}
export interface BrainFactEvidence {
  source_type: string; source_label: string | null; occurred_at: string | null
  excerpt: string | null; contact_id: string | null
}
export interface BrainEngagement {
  id: string; title: string; detail: string | null; status: string; due_window_end: string | null
  is_overdue: boolean | null; resolved_at: string | null; occurred_at: string | null; evidence_count: number
  owner_contact_id: string | null; owner_user_id: string | null; evidence: BrainFactEvidence[]
}
export interface AccountBrainDTO {
  generated_at: string
  account: { id: string; name: string; relation_type: string | null }
  weather: { status: Availability; score?: number; reliability?: number; delta_30d?: number; weakest_dial?: string; verdict_allowed?: boolean; dials?: unknown; reason?: string; history?: Array<{ snapshot_month: string; score: number | null }> }
  dimensions: { status: Availability; reason?: string; items?: unknown }
  situation: { status: Availability; kind?: 'synthesis'; statement?: string; confidence?: number; generated_at?: string; reason?: string }
  delta_since_last: { status: Availability; t0?: string; personal?: boolean; team_last?: string; message?: string; facts?: BrainFact[] }
  active_facts: BrainFact[]
  engagements: BrainEngagement[]
  recommendations: BrainRecommendation[]
  history: Array<{ id: string; fact_type: string; title: string; impact: string | null; occurred_at: string | null; status: string }>
  availability: Record<string, Availability>
}

/** Signal classé : un fait + sa pertinence explicable (jamais un nombre opaque). */
export interface RankedSignal { fact: BrainFact; relevance: RelevanceResult }

const RELATION_MAP: Record<string, RelationType> = {
  prospect: 'prospect', client: 'client', partenaire: 'partenaire', partner: 'partenaire',
  fournisseur: 'fournisseur', investisseur: 'investisseur', interne: 'interne', collègue: 'interne', collegue: 'interne',
}
export function toRelationType(raw: string | null | undefined): RelationType {
  return RELATION_MAP[(raw ?? '').trim().toLowerCase()] ?? 'autre'
}

function factToRelevanceInput(f: BrainFact, objectiveFactIds: Set<string>): FactForRelevance {
  // Un état permanent (bus factor, relai unique…) n'est pas un « signal récent » (§37).
  const isPermanent = f.fact_type === 'role' || (f.impact === 'neutral' && f.fact_type === 'event' && f.evidence_count <= 1)
  return {
    factType: f.fact_type, impact: f.impact, occurredAt: f.occurred_at, firstSeenAt: f.first_seen_at,
    dueWindowEnd: f.due_window_end, isOverdue: f.is_overdue ?? false, confidence: f.confidence,
    inferenceLevel: f.inference_level, linkedToObjective: objectiveFactIds.has(f.id), isPermanentState: isPermanent,
  }
}

/**
 * « Signaux récents » : classe les faits actifs par pertinence et ne garde que
 * les CHANGEMENTS qui méritent l'attention. Explicable (priority_breakdown).
 * Le front prend les `topN` premiers.
 */
export function rankSignals(dto: AccountBrainDTO, opts: { topN?: number; objectiveFactIds?: Set<string>; now?: Date } = {}): RankedSignal[] {
  const rel = toRelationType(dto.account.relation_type)
  const objIds = opts.objectiveFactIds ?? new Set<string>()
  const now = opts.now ?? new Date()
  return dto.active_facts
    .map((fact) => ({ fact, relevance: computeRelevance(deriveRelevanceDimensions(factToRelevanceInput(fact, objIds), rel, now)) }))
    .sort((a, b) => b.relevance.priority - a.relevance.priority)
    .slice(0, opts.topN ?? dto.active_facts.length)
}

/** Facts survenus depuis t0 personnel, classés par pertinence (« Depuis votre dernier échange »). */
export function rankDelta(dto: AccountBrainDTO, opts: { now?: Date } = {}): { status: Availability; message?: string; teamLast?: string; signals: RankedSignal[] } {
  const d = dto.delta_since_last
  if (d.status !== 'available') return { status: d.status, message: d.message, teamLast: d.team_last, signals: [] }
  const rel = toRelationType(dto.account.relation_type)
  const now = opts.now ?? new Date()
  const signals = (d.facts ?? [])
    .map((fact) => ({ fact, relevance: computeRelevance(deriveRelevanceDimensions(factToRelevanceInput(fact, new Set()), rel, now)) }))
    .sort((a, b) => b.relevance.priority - a.relevance.priority)
  return { status: 'available', signals }
}

/** Appel réel de l'RPC (front). */
export async function fetchAccountBrain(organizationId: string, companyId: string): Promise<AccountBrainDTO> {
  const { getSupabase } = await import('../../lib/supabase')
  const { data, error } = await getSupabase().rpc('account_brain', { p_organization_id: organizationId, p_company_id: companyId })
  if (error) throw error
  return data as AccountBrainDTO
}

/** ✓ « Fait » sur un engagement actif — statut terminal global (tenu). */
export async function resolveAccountEngagement(organizationId: string, companyId: string, factId: string, userId: string): Promise<void> {
  const { getSupabase } = await import('../../lib/supabase')
  const now = new Date().toISOString()
  const { error } = await getSupabase().from('account_facts')
    .update({ status: 'resolved', resolved_at: now, resolved_by: userId, updated_at: now })
    .eq('organization_id', organizationId).eq('company_id', companyId).eq('id', factId)
  if (error) throw error
}

/** × « Pas pour moi » sur un engagement — masque UNIQUEMENT pour l'utilisateur
 *  courant (account_fact_user_state.ignored_at), même doctrine que
 *  dismissRecommendationForMe : ne touche jamais account_facts.status. */
export async function dismissAccountEngagementForMe(organizationId: string, companyId: string, factId: string, userId: string): Promise<void> {
  const { getSupabase } = await import('../../lib/supabase')
  const { error } = await getSupabase().from('account_fact_user_state').upsert({
    fact_id: factId, user_id: userId, organization_id: organizationId, company_id: companyId,
    ignored_at: new Date().toISOString(), ignore_reason: 'not_relevant',
  }, { onConflict: 'fact_id,user_id' })
  if (error) throw error
}
