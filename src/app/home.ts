/**
 * Vue Home — cockpit relationnel quotidien.
 *
 * Deux expériences (mission §5) :
 *   A. première synchronisation (S0 invitation → S1 détection → S2 sélection
 *      → S3 activation), pilotée par des jobs réels persistés dans sync_jobs ;
 *   B. cockpit quotidien (forfait, digest, score global, sources, compteurs,
 *      Top 5, coaching, actions du jour, signaux).
 *
 * Toutes les données viennent de getHomeDashboard() (service unique, RLS).
 * Aucune valeur n'est simulée : ce qui n'existe pas en base est affiché
 * « Données insuffisantes » ou masqué.
 */

import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import {
  detectAccountCandidates,
  getHomeDashboard,
  getJob,
  markHomeSeen,
  saveActionState,
  saveInsightFeedback,
  setTrackedCompanies,
} from './home-service'
import { saveSignalFeedback, type ProfileRow } from './data'
import { relationLevel } from './home-types'
import type {
  HomeAccountCandidate,
  HomeDashboardData,
  HomePriorityAction,
  HomeRelationLevel,
  HomeSignal,
} from './home-types'

export type HomeContext = {
  container: HTMLElement
  session: Session
  profile: ProfileRow
  organizationId: string
  toast: (message: string, type?: 'default' | 'error') => void
  goView: (view: 'cerveau' | 'acc' | 'per' | 'connecteurs' | 'me') => void
  /** Ouvre Ask Tohu avec un contexte prérempli (mode simulation). */
  askSimulation: (prompt: string) => void
  onCounts?: (accounts: number, people: number) => void
  /** Injection (tests, prévisualisation dev) : remplace le service par défaut. */
  loadDashboard?: (organizationId: string, userId: string) => Promise<HomeDashboardData>
}

/* ---------------------------------------------------------------- helpers */

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char)
}

function nameInitials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'T'
}

function formatDate(value: string | null, fallback = '—'): string {
  if (!value) return fallback
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function relativeTime(value: string | null): string {
  if (!value) return 'jamais'
  const delta = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(delta) || delta < 0) return formatDate(value)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} j`
}

const LEVEL_LABELS: Record<HomeRelationLevel, string> = {
  promoter: 'Promoteur',
  passive: 'Passif',
  detractor: 'Détracteur',
  unavailable: 'Score indisponible',
}

const ACTION_LABELS: Record<string, string> = {
  relance: 'Relance',
  mouvement: 'Mouvement',
  risque: 'Risque',
  couverture: 'Couverture',
  validation: 'Validation',
  opportunite: 'Opportunité',
}

const SIGNAL_EMOJI: Array<[RegExp, string]> = [
  [/gouvernance|governance|leadership/i, '🏢'],
  [/job|poste|mouvement|nomination/i, '⇄'],
  [/silence|froid|cool/i, '🕓'],
  [/échéance|deadline|assemblée/i, '📋'],
  [/reprise|opportun/i, '🚀'],
  [/interlocuteur|contact|couverture/i, '🤝'],
  [/baisse|down|détract/i, '📉'],
  [/anniversaire/i, '🎂'],
]

function signalEmoji(signal: HomeSignal): string {
  const haystack = `${signal.signalType} ${signal.title}`
  for (const [pattern, emoji] of SIGNAL_EMOJI) if (pattern.test(haystack)) return emoji
  return signal.kind === 'company' ? '🏢' : '👤'
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return 'var(--t4)'
  if (confidence >= 70) return 'var(--sage)'
  if (confidence >= 40) return 'var(--amber)'
  return 'var(--coral)'
}

function emptyState(icon: string, title: string, copy: string, action = ''): string {
  return `<div class="empty-state"><span class="empty-ic">${icon}</span><b>${esc(title)}</b><p>${esc(copy)}</p>${action}</div>`
}

/* ------------------------------------------------------------- lifecycle */

let renderToken = 0

export async function renderHome(ctx: HomeContext): Promise<void> {
  const token = ++renderToken
  ctx.container.innerHTML = skeletonMarkup()
  let data: HomeDashboardData
  try {
    data = await (ctx.loadDashboard ?? getHomeDashboard)(ctx.organizationId, ctx.session.user.id)
  } catch (error) {
    if (token !== renderToken) return
    ctx.container.innerHTML = `<div class="sync-wrap"><div class="sync-card"><div class="sync-ic" aria-hidden="true">⚠</div><div class="sync-t">Impossible de charger la Home</div><p class="sync-s">${esc(error instanceof Error ? error.message : 'Erreur inattendue.')}</p><button class="sync-cta" data-home="retry">Réessayer</button></div></div>`
    bindRetry(ctx)
    return
  }
  if (token !== renderToken) return
  ctx.onCounts?.(data.counters.accounts, data.counters.people)

  if (data.onboarding.portfolioReady) {
    renderCockpit(ctx, data)
    void markHomeSeen(ctx.session.user.id).catch(() => { /* colonne absente : digest désactivé, signalé par degradedReasons */ })
    return
  }
  renderOnboarding(ctx, data, token)
}

function bindRetry(ctx: HomeContext): void {
  ctx.container.querySelector('[data-home="retry"]')?.addEventListener('click', () => void renderHome(ctx))
}

function skeletonMarkup(): string {
  return `<div aria-hidden="true">
    <div class="hskel"><i style="max-width:340px"></i><i style="max-width:220px"></i></div>
    <div class="hskel"><i class="big"></i><i style="max-width:420px"></i><i style="max-width:300px"></i></div>
    <div class="hskel"><i style="max-width:260px"></i><i style="max-width:380px"></i><i style="max-width:180px"></i></div>
  </div>`
}

/* ================================================== Expérience A — S0→S3 */

const DETECTION_STEPS = [
  'Connexion au fournisseur',
  'Lecture des métadonnées autorisées',
  'Détection des organisations',
  'Regroupement et déduplication',
  'Préparation des résultats',
]

const ANALYSIS_STEPS = [
  'Activation des comptes sélectionnés',
  'Rattachement des personnes détectées',
  'Initialisation du cockpit',
]

function renderOnboarding(ctx: HomeContext, data: HomeDashboardData, token: number): void {
  // Reprise après refresh : un job actif ou une détection terminée reprennent
  // le parcours là où il s'était arrêté.
  const active = data.onboarding.activeJob
  if (active && active.jobType === 'account_detection') {
    renderStepper(ctx, 'Connexion de ton portefeuille', 'Tohu détecte tes comptes à partir des échanges synchronisés.', DETECTION_STEPS, 2)
    void resumeJob(ctx, data, active.id, token)
    return
  }
  if (active && active.jobType === 'account_analysis') {
    renderStepper(ctx, 'Analyse relationnelle', 'Tohu initialise ton portefeuille.', ANALYSIS_STEPS, 1)
    void resumeJob(ctx, data, active.id, token)
    return
  }
  const detection = data.onboarding.lastDetectionJob
  if (detection?.status === 'completed' && Array.isArray(detection.payload.candidates)) {
    const candidates = (detection.payload.candidates as Array<Record<string, unknown>>).map((raw) => ({
      companyId: typeof raw.company_id === 'string' ? raw.company_id : null,
      name: String(raw.name ?? 'Organisation'),
      domain: typeof raw.domain === 'string' ? raw.domain : null,
      industry: typeof raw.industry === 'string' ? raw.industry : null,
      location: typeof raw.location === 'string' ? raw.location : null,
      interactions: Number(raw.interactions ?? 0) || 0,
      lastInteractionAt: typeof raw.last_interaction_at === 'string' ? raw.last_interaction_at : null,
      source: typeof raw.source === 'string' ? raw.source : 'Messagerie',
      alreadyTracked: raw.already_tracked === true,
      selected: false,
    }))
    if (candidates.length) {
      renderSelection(ctx, data, candidates)
      return
    }
  }
  renderS0(ctx, data)
}

function renderS0(ctx: HomeContext, data: HomeDashboardData): void {
  const connector = data.onboarding.compatibleConnector
  const connBadge = connector
    ? `<div class="sync-conn">● ${esc(connector.label)} connecté${connector.accountEmail ? ` · ${esc(connector.accountEmail)}` : ''}</div>`
    : '<div class="sync-conn off">○ Aucune source de messagerie connectée</div>'
  const lastSync = connector?.lastSyncedAt ? `<div class="sync-meta">Dernière synchronisation : ${esc(relativeTime(connector.lastSyncedAt))}</div>` : ''
  const cta = connector
    ? '<button class="sync-cta" data-home="sync-start">Synchroniser mes comptes</button>'
    : '<button class="sync-cta" data-home="go-connectors">Connecter une source</button>'
  ctx.container.innerHTML = `<div class="sync-wrap"><div class="sync-stage" id="sync-s0">
    <div class="sync-card">
      ${connBadge}
      <div class="sync-ic" aria-hidden="true">⚡</div>
      <h2 class="sync-t">Connecte ton portefeuille</h2>
      <p class="sync-s">Tohu détecte les organisations présentes dans tes échanges, puis prépare leur analyse relationnelle.</p>
      <div class="sync-rgpd"><span aria-hidden="true">🔒</span><span>Tohu lit uniquement les métadonnées autorisées (expéditeur, destinataires, dates, objet). Le corps de tes emails n'est jamais conservé.</span></div>
      ${cta}
      ${lastSync}
      <div class="sync-error" id="sync-error" role="alert"></div>
    </div>
  </div></div>`
  ctx.container.querySelector('[data-home="go-connectors"]')?.addEventListener('click', () => ctx.goView('connecteurs'))
  ctx.container.querySelector('[data-home="sync-start"]')?.addEventListener('click', () => void startDetection(ctx, data))
}

function renderStepper(ctx: HomeContext, title: string, subtitle: string, steps: string[], activeIndex: number): void {
  const chk = '<svg class="stp-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-11"/></svg>'
  const rows = steps.map((step, index) => {
    const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
    return `<div class="stp-row ${state}" data-step="${index}"><span class="stp-dot"><span class="stp-spin"></span>${chk}</span><span class="stp-lbl">${esc(step)}</span></div>`
  }).join('')
  ctx.container.innerHTML = `<div class="sync-wrap"><div class="sync-card lo">
    <div class="lo-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg></div>
    <h2 class="lo-t">${esc(title)}</h2>
    <p class="lo-sub">${esc(subtitle)}</p>
    <div class="stp" aria-live="polite">${rows}</div>
    <div class="sync-error" id="sync-error" role="alert"></div>
  </div></div>`
}

function setStep(ctx: HomeContext, index: number): void {
  ctx.container.querySelectorAll<HTMLElement>('.stp-row').forEach((row) => {
    const step = Number(row.dataset.step)
    row.className = `stp-row ${step < index ? 'done' : step === index ? 'active' : 'pending'}`
  })
}

function stepError(ctx: HomeContext, message: string, retry: () => void): void {
  ctx.container.querySelectorAll<HTMLElement>('.stp-row.active').forEach((row) => { row.className = 'stp-row failed' })
  const box = ctx.container.querySelector('#sync-error')
  if (!box) return
  box.innerHTML = `<div class="inline-error">${esc(message)}</div><button class="btn-secondary" style="margin-top:10px" data-home="retry-step">Réessayer</button>`
  box.querySelector('[data-home="retry-step"]')?.addEventListener('click', retry)
}

/** S1 — étapes réelles : ingestion messagerie puis détection SQL journalisée. */
async function startDetection(ctx: HomeContext, data: HomeDashboardData): Promise<void> {
  const provider = data.onboarding.compatibleConnector?.provider ?? null
  renderStepper(ctx, 'Connexion de ton portefeuille', `Tohu se connecte à ${data.onboarding.compatibleConnector?.label ?? 'ta messagerie'} et détecte tes comptes.`, DETECTION_STEPS, 0)
  try {
    if (provider === 'google' || provider === 'microsoft') {
      setStep(ctx, 1)
      const { data: syncResult, error } = await getSupabase().functions.invoke('sync-email-analysis', { body: { organizationId: ctx.organizationId, provider } })
      if (error || syncResult?.error) throw error ?? new Error(String(syncResult.error))
    }
    setStep(ctx, 2)
    const detection = await detectAccountCandidates(ctx.organizationId)
    setStep(ctx, 4)
    if (!detection.candidates.length) {
      ctx.container.innerHTML = `<div class="sync-wrap"><div class="sync-card">${emptyState('▦', 'Aucune organisation détectée', 'Tohu n’a pas trouvé d’organisation dans les échanges synchronisés. Ajoute une source ou crée un compte manuellement.', '<div style="display:flex;gap:8px;justify-content:center;margin-top:6px"><button class="btn-secondary" data-home="go-connectors">Gérer les connecteurs</button><button class="btn-view" data-home="go-accounts">Créer un compte</button></div>')}</div></div>`
      ctx.container.querySelector('[data-home="go-connectors"]')?.addEventListener('click', () => ctx.goView('connecteurs'))
      ctx.container.querySelector('[data-home="go-accounts"]')?.addEventListener('click', () => ctx.goView('acc'))
      return
    }
    renderSelection(ctx, data, detection.candidates)
  } catch (error) {
    stepError(ctx, error instanceof Error ? error.message : 'Synchronisation impossible.', () => void startDetection(ctx, data))
  }
}

/** Reprise d'un job actif après actualisation du navigateur. */
async function resumeJob(ctx: HomeContext, data: HomeDashboardData, jobId: string, token: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (token !== renderToken) return
    const job = await getJob(jobId).catch(() => null)
    if (!job || job.status === 'completed' || job.status === 'failed') {
      if (job?.status === 'failed') {
        stepError(ctx, job.errorMessage ?? 'Le job a échoué.', () => void renderHome(ctx))
        return
      }
      void renderHome(ctx)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  void renderHome(ctx)
}

/** S2 — sélection des organisations réellement détectées. */
function renderSelection(ctx: HomeContext, data: HomeDashboardData, candidates: HomeAccountCandidate[]): void {
  const limit = data.plan.limitConfigured ? data.plan.accountLimit : null
  const capacity = limit ?? candidates.length
  candidates.forEach((candidate, index) => { candidate.selected = candidate.alreadyTracked || index < capacity })
  let selected = candidates.filter((candidate) => candidate.selected)
  while (selected.length > capacity) { const last = selected.pop(); if (last) last.selected = false }

  const capLabel = limit !== null
    ? `<div class="sel-cap" aria-live="polite"><b id="sel-count">0</b>/${limit} · offre ${esc(data.plan.name)}</div>`
    : `<div class="sel-cap" aria-live="polite"><b id="sel-count">0</b> sélectionnés · offre ${esc(data.plan.name)}</div>`
  const upsell = limit !== null && candidates.length > limit
    ? `<div class="sel-upsell">🔓 ${candidates.length - limit} autres comptes détectés — <a role="button" tabindex="0" data-home="go-upgrade">passe à l’offre supérieure pour tout suivre →</a></div>`
    : ''
  ctx.container.innerHTML = `<div class="sync-wrap" style="max-width:640px">
    <div class="sel-head">
      <h2 class="sync-t" style="font-size:17px">${candidates.length} compte${candidates.length > 1 ? 's' : ''} détecté${candidates.length > 1 ? 's' : ''}</h2>
      ${capLabel}
    </div>
    <p class="sync-s" style="text-align:left;margin-top:3px">Sélectionne les comptes à suivre — les plus actifs sont pré-cochés.</p>
    <div class="sel-list" id="sel-list" role="group" aria-label="Comptes détectés"></div>
    ${upsell}
    <button class="sync-cta" data-home="analyze" aria-live="polite">Analyser ma sélection (<span id="sel-btn-n">0</span>)</button>
    <div class="sync-error" id="sync-error" role="alert"></div>
  </div>`

  const list = ctx.container.querySelector('#sel-list')
  const render = (): void => {
    if (!list) return
    list.innerHTML = candidates.map((candidate, index) => {
      const meta = [candidate.industry, candidate.location, `${candidate.interactions} échange${candidate.interactions > 1 ? 's' : ''}`, candidate.lastInteractionAt ? `vu ${relativeTime(candidate.lastInteractionAt)}` : null].filter(Boolean).join(' · ')
      return `<button type="button" class="sel-row ${candidate.selected ? 'on' : 'off'}" data-index="${index}" aria-pressed="${candidate.selected}">
        <span class="sel-cb" aria-hidden="true">${candidate.selected ? '✓' : ''}</span>
        <span class="sel-id"><span class="sel-nm">${esc(candidate.name)}</span><span class="sel-mt" style="display:block">${esc(meta || candidate.domain || 'Organisation détectée')}</span></span>
        <span class="sel-nps">à analyser</span>
        <span class="sel-src">${esc(candidate.source)}</span>
      </button>`
    }).join('')
    const count = candidates.filter((candidate) => candidate.selected).length
    const countNode = ctx.container.querySelector('#sel-count')
    const buttonCount = ctx.container.querySelector('#sel-btn-n')
    if (countNode) countNode.textContent = String(count)
    if (buttonCount) buttonCount.textContent = String(count)
    const button = ctx.container.querySelector<HTMLButtonElement>('[data-home="analyze"]')
    if (button) button.disabled = count < 1
  }
  render()

  list?.addEventListener('click', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('.sel-row')
    if (!row) return
    const candidate = candidates[Number(row.dataset.index)]
    if (!candidate) return
    if (!candidate.selected) {
      const count = candidates.filter((item) => item.selected).length
      if (limit !== null && count >= limit) {
        ctx.toast(`L’offre ${data.plan.name} est limitée à ${limit} comptes suivis. Passe à l’offre supérieure pour en suivre davantage.`, 'error')
        return
      }
      candidate.selected = true
    } else {
      candidate.selected = false
    }
    render()
  })
  ctx.container.querySelector('[data-home="go-upgrade"]')?.addEventListener('click', () => ctx.goView('me'))
  ctx.container.querySelector('[data-home="analyze"]')?.addEventListener('click', () => {
    const chosen = candidates.filter((candidate) => candidate.selected)
    if (!chosen.length) return
    void runAnalysis(ctx, chosen)
  })
}

/** S3 — activation réelle (RPC set_tracked_companies) puis révélation du cockpit. */
async function runAnalysis(ctx: HomeContext, chosen: HomeAccountCandidate[]): Promise<void> {
  renderStepper(ctx, 'Analyse relationnelle', `Tohu initialise ton portefeuille de ${chosen.length} compte${chosen.length > 1 ? 's' : ''}.`, ANALYSIS_STEPS, 0)
  try {
    const result = await setTrackedCompanies(ctx.organizationId, chosen.map((candidate) => ({ companyId: candidate.companyId, name: candidate.name, domain: candidate.domain })))
    setStep(ctx, 2)
    ctx.toast(`${result.tracked} compte${result.tracked > 1 ? 's' : ''} activé${result.tracked > 1 ? 's' : ''} · ${result.linkedContacts} personne${result.linkedContacts > 1 ? 's' : ''} rattachée${result.linkedContacts > 1 ? 's' : ''}.`)
    await renderHome(ctx)
  } catch (error) {
    stepError(ctx, error instanceof Error ? error.message : 'Activation impossible.', () => void runAnalysis(ctx, chosen))
  }
}

/* ===================================================== Expérience B — B1-B6 */

function renderCockpit(ctx: HomeContext, data: HomeDashboardData): void {
  ctx.container.innerHTML = [
    data.degraded ? degradedMarkup(data) : '',
    highlightsMarkup(data),
    planBannerMarkup(data),
    digestMarkup(data),
    activityMarkup(data),
    `<div class="home-cockpit-grid">
      <div class="home-cockpit-main">
        ${scoreRowMarkup(data)}
        ${teamVisionMarkup(data)}
        <section class="recommendations-panel" aria-label="Recommandations">
          <div class="section-heading">
            <span class="section-heading-icon" aria-hidden="true">✦</span>
            <div><h2>Recommandations</h2><p>Actions réelles, priorisées à partir des signaux et interactions</p></div>
            <div class="recommendation-filters" role="group" aria-label="Filtrer les recommandations">
              <button class="on" data-action-filter="all">Toutes</button>
              <button data-action-filter="relationship">Relationnelles</button>
              <button data-action-filter="commercial">Commerciales</button>
            </div>
          </div>
          <div class="krs-stack" id="home-actions">${actionsMarkup(data.priorityActions)}</div>
        </section>
        ${coachingMarkup(data)}
      </div>
      <aside class="home-cockpit-rail">
        ${topMarkup(data)}
        ${signalsMarkup(data)}
      </aside>
    </div>`,
  ].join('')
  bindCockpit(ctx, data)
}

function highlightsMarkup(data: HomeDashboardData): string {
  const fromActions = data.priorityActions.slice(0, 2).map((action) => ({
    label: ACTION_LABELS[action.type] ?? action.type,
    tone: action.type === 'risque' ? 'risk' : action.type === 'opportunite' || action.type === 'mouvement' ? 'opportunity' : 'relationship',
    title: action.title,
    accountId: action.accountId,
    personId: action.personId,
  }))
  const items = fromActions.length ? fromActions : data.latestSignals.slice(0, 2).map((signal) => ({
    label: signal.signalType,
    tone: 'signal',
    title: signal.title,
    accountId: signal.accountId,
    personId: signal.personId,
  }))
  if (!items.length) return ''
  return `<section class="home-highlights" aria-label="Highlights du jour">
    <div class="home-highlights-label"><i aria-hidden="true"></i> Highlights du jour</div>
    <div class="home-highlights-stream">${items.map((item) => `<button class="home-highlight" data-tone="${esc(item.tone)}" ${item.accountId ? `data-open-account="${esc(item.accountId)}"` : item.personId ? `data-open-person="${esc(item.personId)}"` : ''}><span>${esc(item.label)}</span><b>${esc(item.title)}</b><i aria-hidden="true">→</i></button>`).join('')}</div>
  </section>`
}

function activityMarkup(data: HomeDashboardData): string {
  const exchange = data.activity.exchanges === null ? 'Le volume d’échanges est indisponible' : `Le cerveau a traité <b>${data.activity.exchanges.toLocaleString('fr-FR')}</b> échanges relationnels`
  const signals = data.activity.signalsToday === null ? '' : `<b>${data.activity.signalsToday}</b> signaux aujourd’hui`
  const sourceDots = data.sources.map((source) => `<span class="brain-source ${source.status}"><i></i>${esc(source.label)}</span>`).join('')
  return `<div class="brain-activity" role="status">
    <span class="brain-activity-icon" aria-hidden="true">✿</span>
    <span>${exchange}${signals ? ` · ${signals}` : ''}</span>
    <button class="brain-sources" data-home="go-connectors" aria-label="Gérer les sources connectées">${sourceDots || '<span class="brain-source disconnected"><i></i>Aucune source</span>'}</button>
    <span class="brain-live"><i></i>${data.activity.lastSyncAt ? `Synchro ${esc(relativeTime(data.activity.lastSyncAt))}` : 'En attente de synchro'}</span>
  </div>`
}

function degradedMarkup(data: HomeDashboardData): string {
  return `<div class="home-degraded" role="status"><span aria-hidden="true">⚠</span><span>Configuration incomplète — certaines fonctions sont désactivées (${esc(data.degradedReasons.slice(0, 3).join(' ; '))}). Applique les migrations Home du dossier supabase/migrations.</span></div>`
}

/* Bloc 1 — bandeau du forfait */
function planBannerMarkup(data: HomeDashboardData): string {
  const { name, trackedAccounts, accountLimit, limitConfigured } = data.plan
  const atLimit = limitConfigured && accountLimit !== null && trackedAccounts >= accountLimit
  const progress = limitConfigured && accountLimit
    ? `<div class="fb-prog"><div class="fb-bar" role="progressbar" aria-valuenow="${trackedAccounts}" aria-valuemin="0" aria-valuemax="${accountLimit}"><i style="width:${Math.min(100, Math.round((trackedAccounts / accountLimit) * 100))}%"></i></div><span class="fb-txt"><b>${trackedAccounts} / ${accountLimit}</b> comptes suivis</span></div>`
    : `<span class="fb-txt"><b>${trackedAccounts}</b> compte${trackedAccounts > 1 ? 's' : ''} suivi${trackedAccounts > 1 ? 's' : ''}</span>`
  const cta = atLimit
    ? '<button class="fb-cta" data-home="go-upgrade">Passer à l’offre supérieure</button>'
    : '<button class="fb-cta ghost" data-home="add-accounts">Ajouter des comptes</button>'
  return `<div class="free-banner"><span class="fb-tag">Tohu ${esc(name)}</span>${progress}${cta}</div>`
}

/* Bloc 2 — résumé depuis la dernière visite */
function digestMarkup(data: HomeDashboardData): string {
  const digest = data.lastVisitDigest
  if (!digest) return ''
  const parts: string[] = []
  if (digest.newSignals) parts.push(`<b>${digest.newSignals} ${digest.newSignals > 1 ? 'nouveaux signaux' : 'nouveau signal'}</b>`)
  if (digest.coolingAccounts) parts.push(`<b>${digest.coolingAccounts} compte${digest.coolingAccounts > 1 ? 's ont' : ' a'} refroidi</b>`)
  if (digest.jobChanges) parts.push(`<b>${digest.jobChanges} mouvement${digest.jobChanges > 1 ? 's' : ''} de poste</b>`)
  if (digest.newPeople) parts.push(`<b>${digest.newPeople} nouvelle${digest.newPeople > 1 ? 's' : ''} personne${digest.newPeople > 1 ? 's' : ''}</b>`)
  if (digest.overdueActions) parts.push(`<b>${digest.overdueActions} action${digest.overdueActions > 1 ? 's' : ''} reportée${digest.overdueActions > 1 ? 's' : ''} à échéance</b>`)
  if (!parts.length) return ''
  return `<div class="hdelta" role="status">
    <span class="hdelta-ic" aria-hidden="true">✨</span>
    <div class="hdelta-t">Depuis ta dernière visite (${esc(relativeTime(digest.since))}) : ${parts.join(', ')}.</div>
    <button class="hdelta-x" data-home="close-digest" aria-label="Fermer le résumé">✕</button>
  </div>`
}

/* Blocs 3-6 — score global et indicateurs */
function scoreRowMarkup(data: HomeDashboardData): string {
  const relation = data.globalRelationship
  const scoreValue = relation.score !== null ? String(relation.score) : '—'
  const trend = relation.delta30d === null
    ? '<div class="hscore-tr">Historique insuffisant pour la tendance</div>'
    : relation.delta30d > 0
      ? `<div class="hscore-tr up">↗ +${relation.delta30d} pts sur 30 j</div>`
      : relation.delta30d < 0
        ? `<div class="hscore-tr down">↘ ${relation.delta30d} pts sur 30 j</div>`
        : '<div class="hscore-tr">→ stable sur 30 j</div>'
  const distribution = relation.distribution
    ? `<div class="hscore-cols" role="img" aria-label="Répartition : ${relation.distribution.promoters}% promoteurs, ${relation.distribution.passives}% passifs, ${relation.distribution.detractors}% détracteurs">
        <div class="hcol"><div class="hcol-bar" style="height:${Math.max(14, relation.distribution.promoters)}%;background:var(--sage)"><span>${relation.distribution.promoters}%</span></div><div class="hcol-k">Promoteurs</div></div>
        <div class="hcol"><div class="hcol-bar" style="height:${Math.max(14, relation.distribution.passives)}%;background:var(--amber)"><span>${relation.distribution.passives}%</span></div><div class="hcol-k">Passifs</div></div>
        <div class="hcol"><div class="hcol-bar" style="height:${Math.max(14, relation.distribution.detractors)}%;background:var(--coral)"><span>${relation.distribution.detractors}%</span></div><div class="hcol-k">Détracteurs</div></div>
      </div>`
    : `<div class="distribution-empty">Données insuffisantes</div>`
  const planCopy = data.plan.accountLimit === null ? `offre ${esc(data.plan.name)} · illimitée` : `sur ${data.plan.accountLimit} · offre ${esc(data.plan.name)}`
  return `<div class="cockpit-kpis">
    <article class="cockpit-kpi score-kpi" aria-label="Score relationnel global">
      <span class="cockpit-kpi-label">Score relationnel global</span>
      <div class="score-kpi-value">${scoreValue}${relation.score !== null ? `<span class="hscore-band ${relation.level}">${LEVEL_LABELS[relation.level]}</span>` : ''}</div>
      ${trend}
      <small>${relation.includedAccounts} compte${relation.includedAccounts > 1 ? 's' : ''} mesuré${relation.includedAccounts > 1 ? 's' : ''}${relation.excludedAccounts ? ` · ${relation.excludedAccounts} sans score` : ''}</small>
    </article>
    <article class="cockpit-kpi distribution-kpi">
      <span class="cockpit-kpi-label">Comptes par NPS</span>
      ${distribution}
    </article>
    <button class="cockpit-kpi number-kpi" data-home="go-accounts" aria-label="Ouvrir les comptes suivis">
      <span class="cockpit-kpi-label">Comptes suivis</span>
      <strong>${data.counters.accounts}</strong>
      <small>${planCopy}</small>
    </button>
    <button class="cockpit-kpi number-kpi" data-home="go-people" aria-label="Ouvrir les personnes suivies">
      <span class="cockpit-kpi-label">Relations actives</span>
      <strong>${data.counters.activeRelationships}</strong>
      <small>${data.counters.people} personne${data.counters.people > 1 ? 's' : ''} dans la mémoire</small>
    </button>
  </div>`
}

function teamVisionMarkup(data: HomeDashboardData): string {
  const rows = data.teamMembers.length
    ? data.teamMembers.map((member) => `<div class="team-row">
        <span class="team-person">${member.avatarUrl ? `<img src="${esc(member.avatarUrl)}" alt="" />` : `<i>${esc(nameInitials(member.fullName))}</i>`}<b>${esc(member.fullName)}</b></span>
        <span><b>${member.accounts}</b><small>comptes</small></span>
        <span><b>${member.contacts}</b><small>contacts</small></span>
        <span class="team-score ${member.score === null ? 'unavailable' : relationLevel(member.score)}"><small>Score</small><b>${member.score ?? '—'}</b></span>
        <span class="team-delta ${member.delta30d === null ? '' : member.delta30d >= 0 ? 'up' : 'down'}">${member.delta30d === null ? '—' : `${member.delta30d > 0 ? '+' : ''}${member.delta30d} pts`}</span>
      </div>`).join('')
    : emptyState('♙', 'Vision d’équipe en construction', 'Les responsables apparaîtront ici quand les contacts leur seront attribués.')
  return `<section class="team-vision" aria-label="Vision d’équipe">
    <div class="section-heading">
      <span class="section-heading-icon" aria-hidden="true">♙</span>
      <div><h2>Vision d’équipe</h2><p>Portefeuilles et scores calculés depuis les contacts attribués</p></div>
      <span class="team-period">30 jours</span>
    </div>
    <div class="team-table">
      <div class="team-table-head"><span>Responsable</span><span>Comptes</span><span>Contacts</span><span>Score</span><span>Progression</span></div>
      ${rows}
    </div>
  </section>`
}

function topMarkup(data: HomeDashboardData): string {
  const { best, atRisk } = data.topAccounts
  const bestRows = best.length
    ? best.map((account, index) => `<button type="button" class="htoprow" data-open-account="${esc(account.id)}">
        <span class="htop-rk">${index + 1}</span>
        <span class="htop-nm">${esc(account.name)}${account.industry ? ` <span class="htop-mt">· ${esc(account.industry)}</span>` : ''}</span>
        ${account.trend ? `<span class="htop-tr" aria-label="tendance">${account.trend === 'up' ? '↗' : account.trend === 'down' ? '↘' : '→'}</span>` : ''}
        <span class="htop-sc ${account.level}">${account.score ?? '—'}</span>
        <span class="htop-more">voir +</span>
      </button>`).join('')
    : emptyState('🏆', 'Pas encore de classement', 'Les scores apparaîtront après les premières analyses.')
  const riskRows = atRisk.length
    ? atRisk.map((account, index) => `<button type="button" class="htoprow" data-open-account="${esc(account.id)}" title="${esc(account.riskReasons.join(' · '))}">
        <span class="htop-rk">${index + 1}</span>
        <span class="htop-nm">${esc(account.name)}<span class="htop-mt" style="display:block">${esc(account.riskReasons[0] ?? '')}</span></span>
        <span class="htop-sc ${account.level}">${account.score ?? '—'}</span>
        <span class="htop-more">voir +</span>
      </button>`).join('')
    : emptyState('✓', 'Aucun compte à risque détecté', 'Tohu surveillera les silences, baisses de score et alertes.')
  return `<section class="htop" aria-label="Top 5 relationnel">
    <div class="htop-h">🏆 Top 5
      <span class="htop-toggle" role="tablist">
        <button role="tab" aria-selected="true" class="on" data-top-tab="best">Meilleurs</button>
        <button role="tab" aria-selected="false" data-top-tab="risk">À risque</button>
      </span>
    </div>
    <div class="htop-list" data-top-list="best">${bestRows}</div>
    <div class="htop-list" data-top-list="risk" hidden>${riskRows}</div>
  </section>`
}

/* Bloc 8 — coaching relationnel */
function coachingMarkup(data: HomeDashboardData): string {
  const coaching = data.coaching
  const head = `<div class="krs-head">
    <span class="krs-cic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg></span>
    <span class="krs-type">Coaching</span>
    <span class="krs-sub">posture · comment mieux communiquer</span>
  </div>`
  if (!coaching) {
    return `<section class="hcoach2" aria-label="Coaching relationnel">${head}${emptyState('◎', 'Pas encore d’analyse de posture', 'Connecte ta messagerie puis lance une synchronisation : Tohu analysera ta façon de communiquer à partir de tes messages envoyés.', '<button class="btn-secondary" data-home="go-connectors">Gérer les connecteurs</button>')}</section>`
  }
  const nodes = ['Éclaireur', 'Connecteur', 'Référent', 'Stratège', 'Légende'].map((label) => `<div class="krs-node lock"><span class="kn-dot" aria-hidden="true">·</span><b>${label}</b></div>`).join('')
  const traits = coaching.traits.length
    ? `<div class="krs-socle-h">Socle observé <span class="krs-sub2">· ${coaching.sourceMessageCount} message${coaching.sourceMessageCount > 1 ? 's' : ''} analysé${coaching.sourceMessageCount > 1 ? 's' : ''}</span></div>
       ${coaching.executiveSummary ? `<div class="krs-arch">${esc(coaching.executiveSummary)}</div>` : ''}
       <div class="krs-grid" style="grid-template-columns:1fr"><div class="krs-col ok">
         ${coaching.traits.slice(0, 4).map((trait) => `<div class="krs-li"><b>${esc(trait.trait)}</b> — ${esc(trait.observation)}${trait.confidence !== null ? ` <span class="krs-sub2">(confiance ${trait.confidence}%)</span>` : ''}</div>`).join('')}
       </div></div>`
    : `<div class="krs-arch">${esc(coaching.executiveSummary ?? 'Analyse disponible, sans observation détaillée pour le moment.')}</div>`
  return `<section class="hcoach2" aria-label="Coaching relationnel">
    ${head}
    <div class="krs-live">
      <span class="krs-live-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14-4.5L3 9M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5L21 15M21 20v-5h-5"/></svg></span>
      <span>Analyse mise à jour ${esc(relativeTime(coaching.updatedAt))}${coaching.confidence !== null ? ` · confiance ${coaching.confidence}%` : ''}${coaching.updatedFrom.length ? ` · source ${esc(coaching.updatedFrom.join(', '))}` : ''}</span>
    </div>
    <div class="krs-lvl">
      <div class="krs-lvl-head">
        <span class="krs-lvl-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z"/><path d="M9 12l2 2 4-4"/></svg></span>
        <div class="krs-lvl-id"><div class="krs-lvl-n">Niveau relationnel</div><div class="krs-lvl-sub">progression évaluée sur la profondeur de tes relations</div></div>
        <span class="krs-lvl-xp">en calibration</span>
      </div>
      <div class="krs-lvl-path"><div class="krs-lvl-track" aria-hidden="true"></div><div class="krs-lvl-nodes">${nodes}</div></div>
      <div class="krs-calib"><span aria-hidden="true">🧭</span><span>Analyse en cours de calibration — les règles d’accès aux niveaux seront calculées côté serveur avant l’activation de cette progression. Aucun niveau n’est affiché tant qu’il n’est pas mesuré.</span></div>
    </div>
    ${traits}
    <div class="krs-foot">
      <button class="krs-simu" data-home="simulate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-4.5L3 9M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5L21 15M21 20v-5h-5"/></svg> Simuler un échange</button>
      <span class="krs-foot-q">Lecture juste ?</span>
      <button class="krs-b ${coaching.userFeedback === 'useful' ? 'on' : ''}" data-home="coach-feedback" data-feedback-type="useful" aria-pressed="${coaching.userFeedback === 'useful'}">👍 Utile</button>
      <button class="krs-b ${coaching.userFeedback === 'inaccurate' ? 'on' : ''}" data-home="coach-feedback" data-feedback-type="inaccurate" aria-pressed="${coaching.userFeedback === 'inaccurate'}">👎 Pas juste</button>
    </div>
  </section>`
}

/* Bloc 9 — actions du jour */
function actionsMarkup(actions: HomePriorityAction[]): string {
  if (!actions.length) {
    return emptyState('🎯', 'Aucune action prioritaire aujourd’hui', 'Tohu te préviendra dès qu’un signal, un silence ou une échéance demandera ton attention.')
  }
  return actions.map((action) => `<article class="krs-card" data-type="${esc(action.type)}" data-action-id="${esc(action.actionId)}">
    <div class="krs-band" aria-hidden="true"></div>
    <div class="krs-main">
      <div class="krs-crow">
        <span class="krs-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z"/></svg></span>
        <span class="krs-kind ${esc(action.type)}">${esc(ACTION_LABELS[action.type] ?? action.type)}</span>
        <span class="krs-at">${esc(action.title)}</span>
        <span class="krs-prio">prio ${action.priority}</span>
      </div>
      <div class="krs-aw">${esc(action.explanation)}</div>
      <div class="krs-arow">
        ${action.accountId ? `<button type="button" class="krs-cpt" data-open-account="${esc(action.accountId)}">🔗 ${esc(action.accountName ?? 'Compte')}</button>` : ''}
        ${action.personId ? `<button type="button" class="krs-cpt" data-open-person="${esc(action.personId)}">👤 ${esc(action.personName ?? 'Personne')}</button>` : ''}
        <span class="krs-asig">↳ ${esc(action.source)} · ${esc(formatDate(action.observedAt))}${action.confidence !== null ? ` · confiance ${action.confidence}%` : ''}</span>
        <span class="krs-do-inline">
          <button class="krs-b sm yes" data-home="action-done" aria-label="Marquer comme fait"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg> Fait</button>
          <button class="krs-b sm later" data-home="action-postpone" aria-label="Reporter à demain">↺</button>
          <button class="krs-b sm no" data-home="action-dismiss" aria-label="Écarter cette action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </span>
      </div>
    </div>
  </article>`).join('')
}

/* Bloc 10 — signaux · veille */
function signalsMarkup(data: HomeDashboardData): string {
  const lastSync = data.sources.map((source) => source.lastSyncedAt).filter((value): value is string => value !== null).sort().pop() ?? null
  const items = data.latestSignals.length
    ? data.latestSignals.map((signal, index) => `<button type="button" class="sig-item" data-signal-index="${index}" ${index >= 6 ? 'hidden data-sig-extra' : ''}>
        <span class="sig-emoji" aria-hidden="true">${signalEmoji(signal)}</span>
        <span class="sig-b">
          <span class="sig-it-t" style="display:block">${esc(signal.title)}</span>
          ${signal.summary ? `<span class="sig-it-d" style="display:block">${esc(signal.summary)}</span>` : ''}
          <span class="sig-meta">
            ${signal.accountName ? `<span class="sig-cpt">${esc(signal.accountName)}</span>` : ''}
            ${signal.personName ? `<span class="sig-cpt">${esc(signal.personName)}</span>` : ''}
            <span class="sig-src">${esc(signal.source)}${signal.inferenceLevel ? ` · ${esc(signal.inferenceLevel)}` : ''}</span>
            <span class="sig-date">${esc(formatDate(signal.observedAt))}</span>
            <span class="sig-conf" style="background:${confidenceColor(signal.confidence)}" title="${signal.confidence !== null ? `confiance ${signal.confidence}%` : 'confiance inconnue'}" aria-label="${signal.confidence !== null ? `confiance ${signal.confidence}%` : 'confiance inconnue'}"></span>
            ${signal.userVerdict ? `<span class="sig-verdict ${signal.userVerdict}">${signal.userVerdict === 'confirmed' ? '✓ confirmé' : '✕ infirmé'}</span>` : ''}
          </span>
        </span>
      </button>`).join('')
    : emptyState('🌐', 'Aucun signal prioritaire aujourd’hui', 'Les signaux détectés par tes sources apparaîtront ici, datés et sourcés.')
  const foot = data.latestSignals.length > 6
    ? `<div class="sig-foot"><button type="button" data-home="expand-signals">Voir toute la veille (${data.latestSignals.length}) →</button></div>`
    : ''
  return `<section class="sig-card" aria-label="Signaux et veille">
    <div class="sig-head">
      <span class="sig-ic" aria-hidden="true">🌐</span>
      <div><div class="sig-ttl">Signaux · veille</div><div class="sig-sub">multi-compte · faits datés à valider</div></div>
    </div>
    <div class="rc-sync"><span class="spinner" aria-hidden="true"></span><span>Dernière synchronisation : <b>${esc(relativeTime(lastSync))}</b></span></div>
    <div class="syncbar" aria-hidden="true"></div>
    <div class="sig-body">${items}</div>
    ${foot}
  </section>`
}

/* ------------------------------------------------------------ interactions */

function bindCockpit(ctx: HomeContext, data: HomeDashboardData): void {
  const root = ctx.container
  root.querySelectorAll('[data-home="go-connectors"]').forEach((node) => node.addEventListener('click', () => ctx.goView('connecteurs')))
  root.querySelectorAll('[data-home="go-upgrade"]').forEach((node) => node.addEventListener('click', () => ctx.goView('me')))
  root.querySelectorAll('[data-home="go-accounts"]').forEach((node) => node.addEventListener('click', () => ctx.goView('acc')))
  root.querySelectorAll('[data-home="go-people"]').forEach((node) => node.addEventListener('click', () => ctx.goView('per')))
  root.querySelector('[data-home="close-digest"]')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLElement).closest('.hdelta')?.remove()
  })
  root.querySelector('[data-home="add-accounts"]')?.addEventListener('click', () => void startDetection(ctx, data))
  root.querySelectorAll<HTMLButtonElement>('[data-top-tab]').forEach((tab) => tab.addEventListener('click', () => {
    root.querySelectorAll<HTMLButtonElement>('[data-top-tab]').forEach((node) => {
      const on = node === tab
      node.classList.toggle('on', on)
      node.setAttribute('aria-selected', String(on))
    })
    root.querySelectorAll<HTMLElement>('[data-top-list]').forEach((list) => { list.hidden = list.dataset.topList !== tab.dataset.topTab })
  }))
  root.querySelectorAll<HTMLButtonElement>('[data-action-filter]').forEach((filter) => filter.addEventListener('click', () => {
    const selected = filter.dataset.actionFilter ?? 'all'
    const relationship = new Set(['relance', 'risque', 'couverture', 'validation'])
    const commercial = new Set(['mouvement', 'opportunite'])
    root.querySelectorAll<HTMLButtonElement>('[data-action-filter]').forEach((button) => button.classList.toggle('on', button === filter))
    root.querySelectorAll<HTMLElement>('#home-actions .krs-card').forEach((card) => {
      const type = card.dataset.type ?? ''
      card.hidden = selected === 'relationship' ? !relationship.has(type) : selected === 'commercial' ? !commercial.has(type) : false
    })
  }))
  root.querySelector('[data-home="expand-signals"]')?.addEventListener('click', (event) => {
    root.querySelectorAll<HTMLElement>('[data-sig-extra]').forEach((node) => { node.hidden = false })
    ;(event.currentTarget as HTMLElement).closest('.sig-foot')?.remove()
  })
  root.querySelector('[data-home="simulate"]')?.addEventListener('click', () => {
    const target = data.topAccounts.atRisk[0] ?? data.topAccounts.best[0]
    ctx.askSimulation(`Mode simulation — je veux préparer un échange${target ? ` avec ${target.name}` : ''}. Situation : `)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-home="coach-feedback"]').forEach((button) => button.addEventListener('click', () => {
    const coaching = data.coaching
    const type = button.dataset.feedbackType
    if (!coaching || (type !== 'useful' && type !== 'inaccurate')) return
    void saveInsightFeedback({ organizationId: ctx.organizationId, userId: ctx.session.user.id, insightId: coaching.insightId, feedbackType: type })
      .then(() => {
        root.querySelectorAll('[data-home="coach-feedback"]').forEach((node) => { node.classList.remove('on'); node.setAttribute('aria-pressed', 'false') })
        button.classList.add('on')
        button.setAttribute('aria-pressed', 'true')
        ctx.toast('Merci — ton retour affine l’analyse.')
      })
      .catch((error) => ctx.toast(error instanceof Error ? error.message : 'Feedback non enregistré.', 'error'))
  }))
  bindActions(ctx, data)
  bindSignalDrawer(ctx, data)
}

function bindActions(ctx: HomeContext, data: HomeDashboardData): void {
  const stack = ctx.container.querySelector('#home-actions')
  if (!stack) return
  stack.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-home^="action-"]')
    if (!button) return
    const card = button.closest<HTMLElement>('.krs-card')
    const action = data.priorityActions.find((item) => item.actionId === card?.dataset.actionId)
    if (!card || !action) return
    const kind = button.dataset.home === 'action-done' ? 'completed' : button.dataset.home === 'action-postpone' ? 'postponed' : 'dismissed'
    const postponedUntil = kind === 'postponed' ? new Date(Date.now() + 86_400_000).toISOString() : null
    void saveActionState({
      organizationId: ctx.organizationId,
      userId: ctx.session.user.id,
      actionId: action.actionId,
      actionType: action.type,
      status: kind,
      accountId: action.accountId,
      personId: action.personId,
      sourceSignalId: action.sourceSignalId,
      postponedUntil,
    }).then(() => {
      // Mise à jour optimiste : la carte sort, l'action suivante entre.
      data.priorityActions = data.priorityActions.filter((item) => item.actionId !== action.actionId)
      card.classList.add('leaving')
      window.setTimeout(() => {
        const stackNode = ctx.container.querySelector('#home-actions')
        if (stackNode) stackNode.innerHTML = actionsMarkup(data.priorityActions.slice(0, 3))
      }, 280)
      ctx.toast(kind === 'completed' ? 'Action validée — ajoutée à la mémoire relationnelle.' : kind === 'postponed' ? 'Action reportée à demain.' : 'Action écartée — signal d’apprentissage enregistré.')
    }).catch((error) => ctx.toast(error instanceof Error ? error.message : 'Action non enregistrée.', 'error'))
  })
}

function bindSignalDrawer(ctx: HomeContext, data: HomeDashboardData): void {
  ctx.container.querySelectorAll<HTMLButtonElement>('[data-signal-index]').forEach((item) => item.addEventListener('click', () => {
    const signal = data.latestSignals[Number(item.dataset.signalIndex)]
    if (signal) openSignalDrawer(ctx, signal)
  }))
}

/** Drawer détail d'un signal : fait, preuves, sources, actions (mission §10). */
function openSignalDrawer(ctx: HomeContext, signal: HomeSignal): void {
  document.querySelector('.sig-drawer')?.remove()
  const drawer = document.createElement('div')
  drawer.className = 'sig-drawer'
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-modal', 'true')
  drawer.setAttribute('aria-label', `Détail du signal : ${signal.title}`)
  const fact = (label: string, value: string): string => `<div class="fact"><span>${esc(label)}</span><b>${value}</b></div>`
  drawer.innerHTML = `<div class="sig-drawer-panel">
    <div class="sig-drawer-head">
      <span class="sig-emoji" aria-hidden="true">${signalEmoji(signal)}</span>
      <h3>${esc(signal.title)}</h3>
      <button class="sig-drawer-close" data-drawer="close" aria-label="Fermer">×</button>
    </div>
    ${signal.summary ? `<p style="color:var(--t2);line-height:1.6;margin:0 0 4px">${esc(signal.summary)}</p>` : ''}
    <div class="sig-drawer-facts detail-facts" style="grid-template-columns:1fr 1fr">
      ${fact('Source', esc(signal.source))}
      ${fact('Observé le', esc(formatDate(signal.observedAt)))}
      ${fact('Confiance', signal.confidence !== null ? `${signal.confidence}%` : 'Non mesurée')}
      ${fact('Niveau d’inférence', esc(signal.inferenceLevel ?? 'Non renseigné'))}
      ${signal.accountName ? fact('Compte', esc(signal.accountName)) : ''}
      ${signal.personName ? fact('Personne', esc(signal.personName)) : ''}
      ${fact('Règle', signal.kind === 'company' ? 'Veille entreprise (company_signals)' : 'Analyse comportementale (behavioral_signals)')}
      ${fact('Statut', signal.userVerdict === 'confirmed' ? '✓ Confirmé par toi' : signal.userVerdict === 'dismissed' ? '✕ Infirmé par toi' : 'À valider')}
    </div>
    <div class="sig-drawer-actions">
      <button class="btn-view" data-drawer="confirm">✓ Confirmer</button>
      <button class="btn-secondary" data-drawer="dismiss">✕ Infirmer</button>
      ${signal.accountId ? `<button class="btn-secondary" data-open-account="${esc(signal.accountId)}">Ouvrir le compte</button>` : ''}
      ${signal.personId ? `<button class="btn-secondary" data-open-person="${esc(signal.personId)}">Ouvrir la personne</button>` : ''}
    </div>
  </div>`
  const close = (): void => drawer.remove()
  drawer.addEventListener('click', (event) => {
    if (event.target === drawer || (event.target as Element).closest('[data-drawer="close"]')) close()
    if ((event.target as Element).closest('[data-open-account],[data-open-person]')) close()
  })
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) }
  })
  const verdictHandler = (verdict: 'confirmed' | 'dismissed') => (): void => {
    void saveSignalFeedback(signal.id, ctx.session.user.id, verdict)
      .then(() => {
        signal.userVerdict = verdict
        ctx.toast(verdict === 'confirmed' ? 'Signal confirmé — merci.' : 'Signal infirmé — Tohu en tiendra compte.')
        close()
        void renderHome(ctx)
      })
      .catch((error) => ctx.toast(error instanceof Error ? error.message : 'Feedback non enregistré.', 'error'))
  }
  drawer.querySelector('[data-drawer="confirm"]')?.addEventListener('click', verdictHandler('confirmed'))
  drawer.querySelector('[data-drawer="dismiss"]')?.addEventListener('click', verdictHandler('dismissed'))
  document.body.appendChild(drawer)
  drawer.querySelector<HTMLButtonElement>('.sig-drawer-close')?.focus()
}
