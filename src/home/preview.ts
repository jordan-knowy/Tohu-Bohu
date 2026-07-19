/**
 * Prévisualisation DEV de la Home — jamais buildée en production
 * (absente des inputs de vite.config.ts et gardée par import.meta.env.DEV).
 * Sert uniquement à vérifier visuellement les états avec des fixtures
 * explicitement fictives, sans session Supabase.
 */

import type { Session } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/home.css'
import '../styles/account-list.css'
import { renderHome } from './render'
import type { ProfileRow } from '../services/data'
import type { HomeDashboardData } from './types'

if (!import.meta.env.DEV) {
  window.location.replace('/tohu-app.html')
}

let errorCount = 0
const badge = document.getElementById('console-errors')
const originalError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  errorCount++
  if (badge) { badge.textContent = `console: ${errorCount} erreur${errorCount > 1 ? 's' : ''}`; badge.style.color = '#F0A0AD' }
  originalError(...args)
}
window.addEventListener('error', () => {
  errorCount++
  if (badge) { badge.textContent = `console: ${errorCount} erreur${errorCount > 1 ? 's' : ''}`; badge.style.color = '#F0A0AD' }
})

const now = new Date()
const iso = (daysAgo: number): string => new Date(now.getTime() - daysAgo * 86_400_000).toISOString()

function base(): HomeDashboardData {
  return {
    generatedAt: now.toISOString(),
    workspaceId: 'preview-org',
    degraded: false,
    degradedReasons: [],
    onboarding: {
      portfolioReady: true,
      trackingColumnAvailable: true,
      compatibleConnector: { provider: 'microsoft', label: 'Microsoft 365', status: 'connected', lastSyncedAt: iso(0.01), accountEmail: 'preview@exemple.dev' },
      activeJob: null,
      lastDetectionJob: null,
    },
    plan: { name: 'free', trackedAccounts: 5, accountLimit: 5, limitConfigured: true, status: 'active' },
    lastVisitDigest: { since: iso(2), newSignals: 3, coolingAccounts: 1, jobChanges: 1, newPeople: 2, overdueActions: 0 },
    globalRelationship: {
      score: 58,
      level: 'passive',
      confidence: 64,
      computedAt: iso(0.2),
      delta30d: 4,
      includedAccounts: 4,
      excludedAccounts: 1,
      distribution: { promoters: 33, passives: 50, detractors: 17 },
    },
    benchmark: null,
    sources: [
      { provider: 'microsoft:mail', label: 'Mail · Microsoft 365', status: 'connected', lastSyncedAt: iso(0.01), accountEmail: 'preview@exemple.dev' },
      { provider: 'microsoft:calendar', label: 'Calendrier · Microsoft 365', status: 'partial', lastSyncedAt: iso(0.01), accountEmail: 'preview@exemple.dev' },
      { provider: 'linkedin', label: 'LinkedIn', status: 'disconnected', lastSyncedAt: null, accountEmail: null },
    ],
    activity: { exchanges: 1248, signalsToday: 37, lastSyncAt: iso(0.01) },
    counters: { accounts: 5, accountsDelta30d: 2, people: 14, peopleDelta30d: 3, activeRelationships: 3, decliningRelationships: 1 },
    topAccounts: {
      best: [
        { id: 'p1', name: 'Fixture Alpha', industry: 'Conseil', score: 72, level: 'promoter', confidence: 70, trend: 'up', lastInteractionAt: iso(2) },
        { id: 'p2', name: 'Fixture Bravo', industry: 'Juridique', score: 70, level: 'promoter', confidence: 55, trend: 'stable', lastInteractionAt: iso(4) },
        { id: 'p3', name: 'Fixture Charlie', industry: null, score: 61, level: 'passive', confidence: null, trend: null, lastInteractionAt: iso(9) },
      ],
      atRisk: [
        { id: 'p4', name: 'Fixture Delta', industry: 'Immobilier', score: 39, level: 'detractor', confidence: 40, trend: 'down', lastInteractionAt: iso(41), riskScore: 78, riskReasons: ['score détracteur (39)', '41 j sans contact', 'un seul interlocuteur connu'] },
        { id: 'p5', name: 'Fixture Echo', industry: null, score: 55, level: 'passive', confidence: 62, trend: 'down', lastInteractionAt: iso(35), riskScore: 52, riskReasons: ['en baisse de 8 pts sur 30 j', '35 j sans contact'] },
      ],
    },
    teamMembers: [
      { userId: 'u1', fullName: 'Alex Martin', avatarUrl: null, accounts: 2, contacts: 6, score: 62, delta30d: 4 },
      { userId: 'u2', fullName: 'Sam Lee', avatarUrl: null, accounts: 1, contacts: 4, score: 58, delta30d: 2 },
      { userId: 'u3', fullName: 'Camille Robert', avatarUrl: null, accounts: 2, contacts: 4, score: 54, delta30d: -3 },
    ],
    coaching: {
      level: null,
      calibrating: true,
      executiveSummary: 'Fixture : communication directe et factuelle, appuyée sur des chiffres.',
      cognitiveMode: 'analytique',
      traits: [
        { trait: 'Clarté', observation: 'Va droit au but dans les messages courts (fixture).', confidence: 72 },
        { trait: 'Structure', observation: 'Synthétise les décisions par écrit (fixture).', confidence: 64 },
      ],
      communicationStyle: {},
      sourceMessageCount: 41,
      updatedFrom: ['microsoft', 'email'],
      updatedAt: iso(0.05),
      confidence: 68,
      insightId: 'preview-insight',
      userFeedback: null,
    },
    priorityActions: [
      { actionId: 'relance:p4', type: 'relance', title: 'Silence prolongé — relancer Fixture Delta', explanation: '41 j sans contact · score 39. Reprends langue avant que la relation ne refroidisse.', priority: 84, accountId: 'p4', accountName: 'Fixture Delta', personId: null, personName: null, source: 'Historique des interactions', observedAt: iso(41), confidence: 90, sourceSignalId: null, recommended: 'Reprendre contact cette semaine' },
      { actionId: 'mouvement:sig1', type: 'mouvement', title: 'Nouveau décideur — à confirmer', explanation: 'Un contact connu apparaît sous un nouveau rôle (fixture, 1 source).', priority: 76, accountId: 'p1', accountName: 'Fixture Alpha', personId: null, personName: null, source: 'LinkedIn', observedAt: iso(3), confidence: 55, sourceSignalId: 'sig1', recommended: 'Confirmer le mouvement' },
      { actionId: 'couverture:p2', type: 'couverture', title: 'Un seul interlocuteur chez Fixture Bravo', explanation: 'La relation repose sur une seule personne : élargis la couverture.', priority: 62, accountId: 'p2', accountName: 'Fixture Bravo', personId: null, personName: null, source: 'Couverture des contacts', observedAt: iso(0), confidence: 85, sourceSignalId: null, recommended: 'Identifier un second contact' },
      { actionId: 'validation:sig2', type: 'validation', title: 'À valider : échéance détectée', explanation: 'Signal à confiance limitée (fixture).', priority: 41, accountId: 'p5', accountName: 'Fixture Echo', personId: null, personName: null, source: 'BODACC', observedAt: iso(6), confidence: 45, sourceSignalId: 'sig2', recommended: 'Confirmer ou infirmer' },
    ],
    latestSignals: [
      { id: 'sig1', kind: 'behavioral', signalType: 'job_change', title: 'Mouvement de poste détecté', summary: 'Un contact apparaît sous un nouveau rôle (fixture).', accountId: 'p1', accountName: 'Fixture Alpha', personId: 'per1', personName: 'Contact Fixture', source: 'LinkedIn', observedAt: iso(3), confidence: 55, inferenceLevel: 'inferred', userVerdict: null },
      { id: 'sig2', kind: 'company', signalType: 'deadline', title: 'Échéance approche', summary: 'Fenêtre de décision sous 60 j (fixture).', accountId: 'p5', accountName: 'Fixture Echo', personId: null, personName: null, source: 'BODACC', observedAt: iso(6), confidence: 82, inferenceLevel: 'observed', userVerdict: null },
      { id: 'sig3', kind: 'company', signalType: 'governance', title: 'Changement de gouvernance', summary: 'Le décideur historique n’est plus seul à trancher (fixture).', accountId: 'p4', accountName: 'Fixture Delta', personId: null, personName: null, source: 'Presse', observedAt: iso(12), confidence: 48, inferenceLevel: 'inferred', userVerdict: 'confirmed' },
      { id: 'sig4', kind: 'behavioral', signalType: 'tone', title: 'Reprise de contact', summary: 'Un contact reprend langue (fixture).', accountId: 'p2', accountName: 'Fixture Bravo', personId: 'per2', personName: 'Autre Fixture', source: 'Outlook', observedAt: iso(15), confidence: 74, inferenceLevel: 'observed', userVerdict: null },
      { id: 'sig5', kind: 'company', signalType: 'news', title: 'Actualité sectorielle', summary: 'Fixture — actualité liée au compte.', accountId: 'p3', accountName: 'Fixture Charlie', personId: null, personName: null, source: 'Presse', observedAt: iso(18), confidence: 60, inferenceLevel: 'observed', userVerdict: null },
      { id: 'sig6', kind: 'company', signalType: 'silence', title: 'Silence prolongé', summary: '41 j sans contact (fixture).', accountId: 'p4', accountName: 'Fixture Delta', personId: null, personName: null, source: 'Historique', observedAt: iso(1), confidence: 90, inferenceLevel: 'observed', userVerdict: null },
      { id: 'sig7', kind: 'company', signalType: 'anniversaire', title: '1 an de relation', summary: 'Occasion de consolider (fixture).', accountId: 'p1', accountName: 'Fixture Alpha', personId: null, personName: null, source: 'Historique', observedAt: iso(20), confidence: 95, inferenceLevel: 'observed', userVerdict: null },
    ],
  }
}

function fixtureFor(state: string): HomeDashboardData {
  const data = base()
  switch (state) {
    case 's0':
      data.onboarding.portfolioReady = false
      return data
    case 's0-disconnected':
      data.onboarding.portfolioReady = false
      data.onboarding.compatibleConnector = null
      data.sources = []
      return data
    case 's2':
      data.onboarding.portfolioReady = false
      data.onboarding.lastDetectionJob = {
        id: 'job-preview',
        jobType: 'account_detection',
        status: 'completed',
        currentStep: 'Préparation des résultats',
        progress: 100,
        provider: 'microsoft',
        startedAt: iso(0.02),
        completedAt: iso(0.01),
        errorMessage: null,
        payload: {
          candidates: [
            { company_id: null, name: 'Fixture Nova', domain: 'nova-fixture.dev', industry: 'Bureau d’études', location: 'Paris', interactions: 41, last_interaction_at: iso(5), source: 'Messagerie connectée', already_tracked: false },
            { company_id: null, name: 'Fixture Atlas', domain: 'atlas-fixture.dev', industry: 'Isolation', location: 'Caen', interactions: 38, last_interaction_at: iso(7), source: 'Messagerie connectée', already_tracked: false },
            { company_id: 'p4', name: 'Fixture Delta', domain: 'delta-fixture.dev', industry: 'Immobilier', location: null, interactions: 31, last_interaction_at: iso(41), source: 'Messagerie connectée', already_tracked: true },
            { company_id: null, name: 'Fixture Lex', domain: 'lex-fixture.dev', industry: 'Cabinet', location: 'Paris', interactions: 27, last_interaction_at: iso(2), source: 'Messagerie connectée', already_tracked: false },
            { company_id: null, name: 'Fixture Valo', domain: 'valo-fixture.dev', industry: 'Syndic', location: null, interactions: 24, last_interaction_at: iso(41), source: 'Messagerie connectée', already_tracked: false },
            { company_id: null, name: 'Fixture Serena', domain: 'serena-fixture.dev', industry: 'Santé', location: 'Lyon', interactions: 19, last_interaction_at: iso(12), source: 'Messagerie connectée', already_tracked: false },
            { company_id: null, name: 'Fixture Marchal', domain: 'marchal-fixture.dev', industry: 'Énergie', location: 'Lyon', interactions: 12, last_interaction_at: iso(20), source: 'Messagerie connectée', already_tracked: false },
          ],
        },
      }
      return data
    case 'empty':
      data.lastVisitDigest = null
      data.globalRelationship = { score: null, level: 'unavailable', confidence: null, computedAt: null, delta30d: null, includedAccounts: 0, excludedAccounts: 5, distribution: null }
      data.topAccounts = { best: [], atRisk: [] }
      data.coaching = null
      data.priorityActions = []
      data.latestSignals = []
      data.counters = { accounts: 5, accountsDelta30d: null, people: 0, peopleDelta30d: null, activeRelationships: 0, decliningRelationships: 0 }
      return data
    case 'degraded':
      data.degraded = true
      data.degradedReasons = ['colonne companies.is_tracked (migration 202607150009)', 'table home_action_states (migration 202607150009)']
      data.lastVisitDigest = null
      data.plan = { name: 'free', trackedAccounts: 5, accountLimit: null, limitConfigured: false, status: 'active' }
      return data
    default:
      return data
  }
}

const state = new URLSearchParams(window.location.search).get('state') ?? 'cockpit'
const container = document.getElementById('home-content')

function toast(message: string, type: 'default' | 'error' = 'default'): void {
  const box = document.getElementById('toasts')
  if (!box) return
  const item = document.createElement('div')
  item.className = `toast ${type === 'error' ? 'error' : ''}`
  item.textContent = message
  box.appendChild(item)
  window.setTimeout(() => item.remove(), 3800)
}

if (container) {
  void renderHome({
    container,
    session: { user: { id: 'preview-user', email: 'preview@exemple.dev' } } as Session,
    profile: { id: 'preview-user', full_name: 'Preview Dev', email: null, avatar_url: null, role: null, role_title: null, company_name: null, website_url: null, product_summary: null, onboarding_completed: true } as ProfileRow,
    organizationId: 'preview-org',
    toast,
    goView: (view) => toast(`(preview) navigation vers « ${view} »`),
    askSimulation: (prompt) => toast(`(preview) Ask Bohu prérempli : ${prompt}`),
    loadDashboard: () => state === 'error'
      ? Promise.reject(new Error('Erreur simulée du service (preview) — vérifie la connexion Supabase.'))
      : Promise.resolve(fixtureFor(state)),
  })
}
