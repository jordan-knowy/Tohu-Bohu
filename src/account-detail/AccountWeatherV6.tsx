// Sections V6 intégrées à la Vue Relation (Météo, Ce qui a changé récemment) —
// consomment UNIQUEMENT public.account_brain (données réelles). Les engagements
// (brain.engagements) sont fusionnés dans « Ce qu'il faut faire », voir
// ActionsSection dans AccountRelationView.tsx. Jamais de valeur de substitution :
// un cadran non calculable reste `null` et s'affiche comme tel, jamais 0/50.
// Réutilise les primitives de preuve communes (SourceBadge/EvidenceItem) et la
// règle d'affichage fiabilité (displayRule).
import { useEffect, useMemo, useState } from 'react'
import { fetchAccountBrain, fetchAccountDyadSnapshots, rankDelta, rankSignals, type AccountBrainDTO, type AccountDyadSnapshotSummary, type FactKind, type RankedSignal } from '../services/account-brain/accountBrain'
import { displayRule } from '../services/scoring/snapshots'
import { PARAMS_V6_PALIER, REGISTRY_V6 } from '../services/scoring/registry-v6'
import type { DialContribution, DialId, DialResult } from '../services/scoring/types'
import type { ReactNode } from 'react'
import { EvidenceItem, EvidenceKindBadge, SourceBadge, type EvidenceKind } from '../components/Evidence'

function relDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return '—'
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  return days === 0 ? "aujourd'hui" : days === 1 ? 'hier' : `il y a ${days} j`
}

const FACT_KIND_TO_EVIDENCE: Record<FactKind, EvidenceKind> = {
  observed_fact: 'fact', deterministic: 'fact', inference: 'inferred', synthesis: 'analysis',
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="acr-empty"><span>◇</span><p>{children}</p></div>
}

// Ordre maquette : Confiance, Satisfaction, Dynamique, Couverture, Équilibre, Ancrage interne.
const DIAL_ORDER: DialId[] = ['d_confiance_recip', 'd_satisfaction', 'd_dynamique', 'd_couverture', 'd_equilibre', 'd_ancrage']
const DIAL_LABEL: Record<DialId, string> = {
  d_satisfaction: 'Satisfaction', d_confiance_recip: 'Confiance', d_couverture: 'Couverture',
  d_equilibre: 'Équilibre', d_ancrage: 'Ancrage interne', d_dynamique: 'Dynamique',
}
/** Description factuelle de la formule réelle (calculateAccountWeatherCore) —
 *  jamais une narration inventée à partir du score : juste ce que le calcul fait. */
const DIAL_HOW: Record<DialId, string> = {
  d_confiance_recip: 'Moyenne pondérée par autorité de la confiance et de la réciprocité mesurées sur les interlocuteurs actifs du compte.',
  d_satisfaction: 'Moyenne pondérée par autorité de la satisfaction mesurée sur les interlocuteurs actifs, ajustée des marqueurs de compte (demandes sans réponse, incidents, rétention de livrable).',
  d_dynamique: 'Combine la tendance récente du score, la régularité des échanges (silence vs cadence habituelle) et le solde engagements tenus/glissés sur 90 jours.',
  d_couverture: 'Part des interlocuteurs décisionnaires réellement en contact, pondérée par leur autorité — plafonnée si un décideur n’a aucun lien direct.',
  d_equilibre: 'Répartition du volume d’échanges entre interlocuteurs (indice inverse de concentration) — un seul contact qui porte tout fait chuter ce cadran.',
  d_ancrage: 'Nombre de porteurs internes réellement actifs sur ce compte — un seul porteur = risque de dépendance (bus factor).',
}
const DIAL_ICON: Record<DialId, ReactNode> = {
  d_satisfaction: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9" /><path d="M9.3 9.6h.01M14.7 9.6h.01" /></svg>,
  d_confiance_recip: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 4.5 7v5c0 4.6 3.2 8.1 7.5 9 4.3-.9 7.5-4.4 7.5-9V7z" /><path d="m9 12 2 2 4-4" /></svg>,
  d_couverture: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="6" r="2.2" /><circle cx="6" cy="17" r="2.2" /><circle cx="18" cy="17" r="2.2" /><path d="M12 8.2v3.3M12 11.5l-4.6 3.6M12 11.5l4.6 3.6" /></svg>,
  d_equilibre: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v15M6 19h12" /><path d="M4.5 9.5 12 7l7.5 2.5" /><path d="M4.5 9.5 2.8 14a2.5 2.5 0 0 0 3.4 0z" /><path d="M19.5 9.5 21.2 14a2.5 2.5 0 0 1-3.4 0z" /></svg>,
  d_ancrage: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="5.5" r="2.2" /><path d="M12 7.7V20M6 13.5c0 3.6 2.7 6.2 6 6.5 3.3-.3 6-2.9 6-6.5M3.8 15.2 6 13.5l2.2 1.7M15.8 15.2 18 13.5l2.2 1.7" /></svg>,
  d_dynamique: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 17.5 9 11.5l3.5 3.5 7-7.5" /><path d="M15.5 7.5h4v4" /></svg>,
}

/** Bande de couleur d'un score — même doctrine que `band()` (AccountRelationView) :
 *  vert ≥70 (soleil), ambre 50–69 (nuage), corail <50 (nuage + pluie). */
function scoreBand(value: number | null): 'good' | 'mid' | 'low' | 'na' {
  return value === null ? 'na' : value >= 70 ? 'good' : value >= 50 ? 'mid' : 'low'
}
const BAND_COLOR: Record<'good' | 'mid' | 'low' | 'na', string> = { good: 'var(--sage)', mid: 'var(--amber)', low: 'var(--coral)', na: 'var(--pale)' }

/** Pictogramme météo par bande — soleil (vert), nuage (ambre), nuage+pluie
 *  (corail) : logique demandée pour rendre le score lisible d'un coup d'œil,
 *  jamais une couleur ou une icône par défaut si le score est non calculable. */
const WEATHER_ICON: Record<'good' | 'mid' | 'low' | 'na', ReactNode> = {
  good: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.6" /><path d="M12 2.6v2.6M12 18.8v2.6M4.2 12H1.6M22.4 12h-2.6M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" /></svg>,
  mid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a3.6 3.6 0 0 0 .5-7.2 5.4 5.4 0 0 0-10.3-1.6A4.4 4.4 0 0 0 7 18.5z" /></svg>,
  low: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 14.5h10.2a3.4 3.4 0 0 0 .5-6.8 5.1 5.1 0 0 0-9.7-1.5A4.2 4.2 0 0 0 6.5 14.5z" /><path d="M8 18.5l-1.2 2.2M12 18.5l-1.2 2.2M16 18.5l-1.2 2.2" /></svg>,
  na: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a3.6 3.6 0 0 0 .5-7.2 5.4 5.4 0 0 0-10.3-1.6A4.4 4.4 0 0 0 7 18.5z" opacity=".4" /><path d="M9.5 9.5 14.5 14.5M14.5 9.5 9.5 14.5" /></svg>,
}
const WEATHER_LABEL: Record<'good' | 'mid' | 'low' | 'na', string> = { good: 'ensoleillé', mid: 'nuageux', low: 'orageux', na: 'à confirmer' }

/** Grande carte cliquable — icône dans un carré lavande, nom, score bandé,
 *  poids à droite, barre + repère circulaire à la position du score, tendance
 *  en dessous. Le clic sélectionne le cadran ; sa lecture réelle s'affiche
 *  dans le panneau `WeatherDetail` sous la grille (jamais un texte générique). */
/** Tendance affichée en carte — jamais le détail technique du calcul (pente/
 *  silence/solde…, resté dans `note` pour l'explication approfondie) : une
 *  info utilisateur ("stable", "-6 sur 30 j") fondée sur une donnée réelle
 *  (trendDelta30d), ou à défaut un état générique honnête. */
function tileTrend(dial: DialId, result: DialResult | undefined, value: number | null): string {
  if (result?.cappedBy) return `plafonné · ${result.cappedBy}`
  if (value === null) return 'Données insuffisantes'
  if (dial === 'd_dynamique' && result?.trendDelta30d != null) {
    const d = result.trendDelta30d
    return d === 0 ? 'stable sur 30 j' : `${d > 0 ? '+' : ''}${d} sur 30 j`
  }
  return 'stable'
}

function WeatherTile({ dial, result, active, onSelect }: { dial: DialId; result: DialResult | undefined; active: boolean; onSelect: () => void }) {
  const value = result?.value ?? null
  const tone = scoreBand(value)
  const weight = Math.round((result?.effectiveWeight ?? result?.weight ?? 0) * 100)
  const trend = tileTrend(dial, result, value)
  return <button type="button" className={`r2-t ${active ? 'on' : ''} ${value === null ? 'na' : ''}`} aria-pressed={active} onClick={onSelect}>
    <span className="r2-t-ic" style={{ color: BAND_COLOR[tone], background: value === null ? undefined : `color-mix(in srgb, ${BAND_COLOR[tone]} 14%, var(--lav))` }}>{DIAL_ICON[dial]}</span>
    <p className="r2-t-nm">{DIAL_LABEL[dial]}</p>
    <div className="r2-t-row">
      <span className="r2-t-v" style={{ color: BAND_COLOR[tone] }}>{value ?? '—'}</span>
      <span className="r2-t-w">{weight}%</span>
    </div>
    <span className="mt-g"><i style={{ width: `${value ?? 0}%`, background: BAND_COLOR[tone] }} />{value !== null && <b style={{ left: `${value}%`, borderColor: BAND_COLOR[tone] }} />}</span>
    <p className="r2-t-dl">{trend}</p>
  </button>
}

/** Libellé métier d'un marqueur — sa règle telle que documentée au registre
 *  V6 (ex. K04 → "livrable contractuel en retard…"), jamais l'identifiant
 *  brut seul : c'est la seule source de vérité pour "ce qui fait bouger le score". */
function markerLabel(markerId: string): string {
  return REGISTRY_V6.markers[markerId]?.rule ?? `Marqueur ${markerId}`
}

/** Cadran → nombre de porteurs internes réels — dérivé du barème anchoring
 *  (base ∈ {0,25,60,100} ↔ {0,1,2,3+} porteurs), jamais un chiffre inventé :
 *  c'est l'entrée exacte qui a produit ce score. */
function anchoringCarriers(base: number | null): string | null {
  if (base === null) return null
  const a = PARAMS_V6_PALIER.anchoring
  if (base <= a[0]) return '0 porteur interne actif'
  if (base <= a[1]) return '1 seul porteur interne actif'
  if (base <= a[2]) return '2 porteurs internes actifs'
  return '3 porteurs internes actifs ou plus'
}

/** Lecture métier du cadran sélectionné — jamais un texte fixe : construite à
 *  partir du score, de sa bande, de son plafond éventuel et des marqueurs
 *  réellement appliqués (jamais une donnée non persistée). */
function buildLecture(dial: DialId, result: DialResult, isWeakest: boolean): string {
  const { value, base, weight, effectiveWeight, cappedBy, modifiers } = result
  if (value === null) return 'Cadran non calculable — donnée insuffisante pour ce cadran précisément.'
  const tone = scoreBand(value)
  const pct = Math.round((effectiveWeight || weight) * 100)
  const topMarker = [...modifiers].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]

  const bandPhrase: Record<DialId, Record<'good' | 'mid' | 'low', string>> = {
    d_confiance_recip: {
      good: `Confiance solide (${value}/100) : les échanges sont réguliers et la réciprocité mesurée sur les interlocuteurs actifs est bonne.`,
      mid: `Confiance intermédiaire (${value}/100) : la relation tient, mais la réciprocité mesurée sur les interlocuteurs actifs reste moyenne.`,
      low: `Confiance fragile (${value}/100) : la confiance et la réciprocité mesurées sur les interlocuteurs actifs sont faibles.`,
    },
    d_satisfaction: {
      good: `Satisfaction élevée (${value}/100) : aucun signal de friction significatif remonté récemment.`,
      mid: `Satisfaction moyenne (${value}/100) : des signaux de friction existent sans être dominants.`,
      low: `Satisfaction basse (${value}/100) : des signaux de friction pèsent nettement sur ce cadran.`,
    },
    d_dynamique: {
      good: `Dynamique positive (${value}/100) : cadence tenue et engagements globalement respectés sur les 90 derniers jours.`,
      mid: `Dynamique modérée (${value}/100) : entre cadence, silence et engagements tenus/glissés, le résultat reste entre-deux.`,
      low: `Dynamique en difficulté (${value}/100) : cadence, silence prolongé ou engagements glissés pèsent sur ce cadran.`,
    },
    d_couverture: {
      good: `Couverture large (${value}/100) : la majorité de l'autorité décisionnaire du compte est réellement en contact.`,
      mid: `Couverture partielle (${value}/100) : une partie de l'autorité décisionnaire du compte n'est pas en contact direct.`,
      low: `Couverture faible (${value}/100) : l'essentiel de l'autorité décisionnaire du compte n'est pas en contact direct.`,
    },
    d_equilibre: {
      good: `Répartition équilibrée (${value}/100) : le volume d'échanges est réparti entre plusieurs interlocuteurs.`,
      mid: `Répartition inégale (${value}/100) : le volume d'échanges repose surtout sur un ou deux interlocuteurs.`,
      low: `Répartition concentrée (${value}/100) : le volume d'échanges repose quasi entièrement sur un seul interlocuteur — risque en cas de départ.`,
    },
    d_ancrage: {
      good: `Ancrage solide (${value}/100) : plusieurs porteurs internes sont réellement actifs sur ce compte.`,
      mid: `Ancrage limité (${value}/100) : peu de porteurs internes sont réellement actifs sur ce compte.`,
      low: `Ancrage fragile (${value}/100) : ${anchoringCarriers(base) ?? 'très peu de porteurs internes actifs'} — risque de dépendance à une seule personne.`,
    },
  }
  const parts = [bandPhrase[dial][tone === 'na' ? 'low' : tone]]
  if (dial === 'd_ancrage' && tone !== 'low') { const c = anchoringCarriers(base); if (c) parts.push(c.charAt(0).toUpperCase() + c.slice(1) + '.') }
  if (dial === 'd_dynamique' && result.trendDelta30d != null && result.trendDelta30d !== 0) {
    parts.push(`Moyenne des autres cadrans ${result.trendDelta30d > 0 ? 'en hausse' : 'en baisse'} de ${Math.abs(result.trendDelta30d)} points sur 30 jours.`)
  }
  if (cappedBy) parts.push(`Plafonné par ${cappedBy} (${markerLabel(cappedBy) || cappedBy}).`)
  if (topMarker) parts.push(`Signal identifié : ${markerLabel(topMarker.markerId)}${topMarker.occurrences > 1 ? ` (${topMarker.occurrences} occurrences)` : ''}.`)
  parts.push(`Pèse ${pct}% de la Météo du compte${isWeakest ? ' — c’est le cadran le plus faible actuellement' : ''}.`)
  return parts.join(' ')
}

/** Panneau « lecture + comment on le calcule » (gauche) / « preuves » (droite)
 *  du cadran sélectionné — factuel, jamais un texte générique quand une valeur
 *  existe, jamais une preuve inventée quand aucune n'est disponible. */
function WeatherDetail({ dial, result, isWeakest }: { dial: DialId; result: DialResult | undefined; isWeakest: boolean }) {
  const value = result?.value ?? null
  const proofs: DialContribution[] = useMemo(
    () => [...(result?.modifiers ?? [])].sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? '')),
    [result],
  )
  return <div className="r2-det">
    <div>
      <p className="r2-det-q">{DIAL_LABEL[dial]} · lecture</p>
      <p className="r2-det-r">{result ? buildLecture(dial, result, isWeakest) : 'Cadran non calculable — donnée insuffisante pour ce cadran précisément.'}</p>
      <hr className="r2-det-sep" />
      <p className="r2-det-h">Comment on le calcule.</p>
      <p className="r2-det-x">{DIAL_HOW[dial]}</p>
    </div>
    <div>
      <p className="r2-det-q">Preuves</p>
      {value !== null && proofs.length > 0
        ? <ul className="r2-det-proofs">{proofs.map((m, i) => <li key={i}>
            <span className="r2-det-pd" style={{ background: m.contribution >= 0 ? 'var(--sage)' : 'var(--coral)' }} />
            <div>
              <p className="r2-det-pt">{m.markerId}{m.observedAt ? ` · ${relDate(m.observedAt)}` : ''}</p>
              <p className="r2-det-pm">{markerLabel(m.markerId)}{m.occurrences > 1 ? ` — ${m.occurrences} occurrences` : ''}</p>
              {m.evidenceText && <EvidenceItem
                kind={m.isVerbatim ? 'fact' : 'inferred'}
                text={m.isVerbatim ? `« ${m.evidenceText} »` : `Résumé : ${m.evidenceText}`}
              />}
            </div>
          </li>)}</ul>
        : <p className="r2-det-x muted">Aucune preuve datée disponible pour cette dimension.</p>}
    </div>
  </div>
}

const WeatherHeaderIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5l3.2 1.9" /></svg>

function monthShortLabel(value: string): string {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(d) : '—'
}

/** Chemin SVG d'un mini sparkline — auto-échelle sur le min/max réellement
 *  observé (jamais une échelle 0–100 qui écraserait une petite variation
 *  réelle en ligne plate). */
function sparkPath(scores: number[], w: number, h: number): string {
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max > min ? max - min : 1
  return scores.map((s, i) => {
    const x = scores.length > 1 ? (i / (scores.length - 1)) * w : w / 2
    const y = h - ((s - min) / range) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

/** Score + pictogramme météo à afficher dans la bannière « Où on en est » —
 *  extrait de la Météo du compte pour que les deux blocs partagent la même
 *  lecture. Le mini graphique/résumé de période s'appuie UNIQUEMENT sur
 *  weather.history (snapshots mensuels réellement persistés) — avec moins de
 *  2 points réels, on affiche un état vide propre, jamais une courbe fabriquée. */
export function WeatherHero({ brain }: { brain: AccountBrainDTO | null }) {
  const w = brain?.weather
  if (!w || w.status !== 'available') return null
  const tone = scoreBand(w.score ?? null)
  const real = (w.history ?? [])
    .filter((h): h is { snapshot_month: string; score: number } => h.score !== null && h.score !== undefined)
    .sort((a, b) => a.snapshot_month.localeCompare(b.snapshot_month))
  const hasSpark = real.length >= 2
  const first = real[0]
  const last = real[real.length - 1]
  const netDelta = hasSpark ? Math.round(last!.score - first!.score) : null
  const midIdx = hasSpark ? Math.floor((real.length - 1) / 2) : null
  const showMid = midIdx !== null && midIdx > 0 && midIdx < real.length - 1

  return <div className="r2-big">
    <p className="r2-big-n"><span className="wx" style={{ color: BAND_COLOR[tone] }} title={WEATHER_LABEL[tone]}>{WEATHER_ICON[tone]}</span>{w.score ?? '—'}<small>/100</small></p>
    <p className="r2-big-k">Météo du compte</p>
    {w.delta_30d != null && <p className="r2-big-s" style={{ color: w.delta_30d < 0 ? '#F5B5BF' : w.delta_30d > 0 ? '#BFE9D2' : undefined }}>{w.delta_30d > 0 ? '↗' : w.delta_30d < 0 ? '↘' : '→'} {w.delta_30d >= 0 ? `+${w.delta_30d}` : w.delta_30d} sur 30 j</p>}
    <hr className="r2-big-sep" />
    {hasSpark ? <>
      <svg className="r2-big-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <path d={sparkPath(real.map((r) => r.score), 100, 30)} />
      </svg>
      <div className="r2-big-marks">
        <span>{monthShortLabel(first!.snapshot_month)}</span>
        {showMid && <span>{monthShortLabel(real[midIdx!]!.snapshot_month)}</span>}
        <span>{monthShortLabel(last!.snapshot_month)}</span>
      </div>
      <p className="r2-big-sum">{real.length} mois · {netDelta! >= 0 ? `+${netDelta}` : netDelta} · {first!.score} → {last!.score}</p>
    </> : <p className="r2-big-empty">Historique pas encore disponible.</p>}
  </div>
}

export function WeatherSection({ brain }: { brain: AccountBrainDTO }) {
  const w = brain.weather
  const rule = w.status === 'available' && w.reliability != null && w.verdict_allowed != null
    ? displayRule(w.reliability, w.verdict_allowed) : null
  const dials = (w.dials ?? null) as Record<DialId, DialResult> | null
  // Sélection par défaut : le premier cadran réellement calculable (jamais un
  // cadran non calculable mis en avant par défaut) ; à défaut, le premier de l'ordre maquette.
  const firstCalculable = useMemo(() => DIAL_ORDER.find((d) => dials?.[d]?.value != null) ?? DIAL_ORDER[0]!, [dials])
  const [selected, setSelected] = useState<DialId>(firstCalculable)
  useEffect(() => { setSelected(firstCalculable) }, [firstCalculable])
  return <section className="sec">
    <div className="sec-h">{WeatherHeaderIcon}<p className="sec-t">Météo du compte</p>
      {w.status === 'available' && w.reliability != null && <span className="cnt">fiabilité <b>{Math.round(w.reliability * 100)}%</b></span>}
      {w.status === 'available' && <span className="hint" title="Un cadran gris est non calculable — donnée insuffisante pour lui précisément, jamais remplacé par une valeur par défaut. Son poids est redistribué sur les cadrans calculables.">?</span>}
    </div>
    <div className="sec-b">
      {w.status !== 'available'
        ? <Empty>Données insuffisantes pour calculer la Météo{w.reason ? ` — ${w.reason}` : '.'}</Empty>
        : <>
          {(rule === 'score_greyed_no_verdict' || rule === 'score_amber') && <div className="v6w-top">
            <div className="v6w-meta">
              {rule === 'score_greyed_no_verdict' && <span className="v6w-warn">Verdict non affiché — fiabilité insuffisante ou trop peu de marqueurs datés.</span>}
              {rule === 'score_amber' && <span className="v6w-warn">Fiabilité modérée.</span>}
            </div>
          </div>}
          <div className="r2-tiles">
            {DIAL_ORDER.map((d) => <WeatherTile key={d} dial={d} result={dials?.[d]} active={selected === d} onSelect={() => setSelected(d)} />)}
          </div>
          <WeatherDetail dial={selected} result={dials?.[selected]} isWeakest={w.weakest_dial === selected} />
        </>}
    </div>
  </section>
}

function SignalRow({ s }: { s: RankedSignal }) {
  const f = s.fact
  return <div className="v6-chg-row">
    <EvidenceKindBadge kind={FACT_KIND_TO_EVIDENCE[f.kind]} />
    <div className="v6-chg-body">
      <p className="v6-chg-t">{f.title}{f.is_overdue && <span className="v6-tag-overdue">en retard</span>}</p>
      {f.detail && <p className="v6-chg-d">{f.detail}</p>}
      <SourceBadge label={f.fact_type} date={f.occurred_at ? relDate(f.occurred_at) : null} />
    </div>
  </div>
}

export function RecentChangeSection({ brain }: { brain: AccountBrainDTO }) {
  const delta = useMemo(() => rankDelta(brain), [brain])
  return <section className="sec">
    <div className="sec-h"><p className="sec-t">Ce qui a changé récemment</p></div>
    <div className="sec-b">
      {delta.status === 'no_personal_interaction'
        ? <Empty>{delta.message ?? "Vous n'avez encore aucun échange personnel observé avec ce compte."}{delta.teamLast ? ` Dernier échange de l'équipe : ${relDate(delta.teamLast)}.` : ''}</Empty>
        : delta.status !== 'available'
          ? <Empty>{delta.message ?? 'Donnée insuffisante.'}</Empty>
          : delta.signals.length
            ? <div className="v6-chg-list">{delta.signals.slice(0, 6).map((s) => <SignalRow key={s.fact.id} s={s} />)}</div>
            : <Empty>Aucun changement significatif depuis votre dernier échange.</Empty>}
    </div>
  </section>
}

/** Charge account_brain une seule fois pour les sections V6 de la Vue Relation
 *  (Météo, Ce qui a changé récemment) et pour les engagements fusionnés dans
 *  « Ce qu'il faut faire » (voir ActionsSection, AccountRelationView.tsx). */
export function useAccountBrain(organizationId: string, companyId: string, enabled: boolean) {
  const [brain, setBrain] = useState<AccountBrainDTO | null>(null)
  useEffect(() => {
    if (!enabled) { setBrain(null); return }
    let cancelled = false
    void fetchAccountBrain(organizationId, companyId).then((dto) => { if (!cancelled) setBrain(dto) }).catch(() => { if (!cancelled) setBrain(null) })
    return () => { cancelled = true }
  }, [organizationId, companyId, enabled])
  return brain
}

/** Snapshots de dyade V6 (un par contact du compte) — pour « Santé du compte ». */
export function useAccountDyadSnapshots(companyId: string, enabled: boolean) {
  const [snapshots, setSnapshots] = useState<AccountDyadSnapshotSummary[] | null>(null)
  useEffect(() => {
    if (!enabled) { setSnapshots(null); return }
    let cancelled = false
    void fetchAccountDyadSnapshots(companyId).then((rows) => { if (!cancelled) setSnapshots(rows) }).catch(() => { if (!cancelled) setSnapshots(null) })
    return () => { cancelled = true }
  }, [companyId, enabled])
  return snapshots
}

export { rankSignals }
