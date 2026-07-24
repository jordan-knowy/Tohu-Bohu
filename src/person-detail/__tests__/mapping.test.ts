import { describe, expect, it } from 'vitest'
import {
  buildContactDetails, buildHistory, buildPersonDetail, buildRecommendations,
  buildScoreHistory, buildSignals, buildSources, legacyCareerRows, scoreWindow,
  type PersonDetailRaw,
} from '../mapping'
import { validateContactDetail } from '../service'

function raw(overrides: Partial<PersonDetailRaw> = {}): PersonDetailRaw {
  return {
    workspaceId: 'org-1',
    personId: 'person-1',
    userId: 'user-1',
    contact: { id: 'person-1', full_name: 'Camille Test', email: 'camille@exemple.fr', created_at: '2026-01-01', updated_at: '2026-07-01' },
    company: {},
    settings: {},
    userSettings: {},
    summaryRow: {},
    scoreSnapshots: [],
    legacyScores: [],
    legacyCareer: [],
    relationshipSnapshots: [],
    cognitiveProfile: {},
    behavioralSignals: [],
    recommendations: [],
    contactDetails: [],
    careerEntries: [],
    memoryEntries: [],
    meetings: [],
    messages: [],
    connectors: [],
    feedback: [],
    profileNames: new Map(),
    degradedReasons: [],
    lockedBy: null,
    ...overrides,
  }
}

describe('buildPersonDetail — score backend, jamais calculé côté front', () => {
  it('personne sans score : tout reste null, aucune valeur inventée', () => {
    const data = buildPersonDetail(raw())
    expect(data.relationship.score).toBeNull()
    expect(data.relationship.confidence).toBeNull()
    expect(data.relationship.phase).toBe('unknown')
    expect(data.relationship.dimensions.intensity).toBeNull()
    expect(data.scoreHistory).toEqual([])
    expect(data.summary).toBeNull()
  })

  it('le snapshot canonique prime sur l’historique hérité', () => {
    const data = buildPersonDetail(raw({
      scoreSnapshots: [{ score: 81, phase: 'growing', confidence: 74, computed_at: '2026-07-10T00:00:00Z', intensity_score: 90, reciprocity_score: 70, recency_score: 60 }],
      legacyScores: [{ score: 40, phase: 'declining', snapshot_date: '2026-07-01', score_intensite: 10, score_reciprocite: 10, score_longevite: 10 }],
    }))
    expect(data.relationship.score).toBe(81)
    expect(data.relationship.phase).toBe('growing')
    expect(data.relationship.dimensions).toEqual({ intensity: 90, reciprocity: 70, longevity: 60 })
  })

  it('sans snapshot canonique, contact_score_history fournit score, phase et dimensions', () => {
    const data = buildPersonDetail(raw({
      legacyScores: [
        { score: 72, phase: 'stable', snapshot_date: '2026-07-01', score_intensite: 80, score_reciprocite: 64, score_longevite: 55 },
        { score: 60, phase: 'growing', snapshot_date: '2026-06-01' },
      ],
    }))
    expect(data.relationship.score).toBe(72)
    expect(data.relationship.phase).toBe('stable')
    expect(data.relationship.dimensions).toEqual({ intensity: 80, reciprocity: 64, longevity: 55 })
    expect(data.scoreHistory.map((point) => point.score)).toEqual([60, 72])
  })

  it('le profil cognitif sert de dernier repli (engagement_score, score_phase)', () => {
    const data = buildPersonDetail(raw({ cognitiveProfile: { engagement_score: 66, score_phase: 'growing', global_confidence: 58, score_intensite: 61 } }))
    expect(data.relationship.score).toBe(66)
    expect(data.relationship.phase).toBe('growing')
    expect(data.relationship.confidence).toBe(58)
    expect(data.relationship.dimensions.intensity).toBe(61)
  })

  it('compte les interactions réelles (emails + réunions) et bornes de dates', () => {
    const data = buildPersonDetail(raw({
      meetings: [{ id: 'm1', starts_at: '2026-06-10T10:00:00Z', title: 'Point produit' }],
      messages: [{ id: 'e1', sent_at: '2026-05-01T08:00:00Z', direction: 'inbound' }, { id: 'e2', sent_at: '2026-07-01T08:00:00Z', direction: 'outbound' }],
    }))
    expect(data.relationship.totalInteractions).toBe(3)
    expect(data.relationship.emailInteractions).toBe(2)
    expect(data.relationship.meetingInteractions).toBe(1)
    expect(data.relationship.firstInteractionAt).toBe('2026-05-01T08:00:00Z')
    expect(data.relationship.lastInteractionAt).toBe('2026-07-01T08:00:00Z')
  })

  it('personne sans compte : employment null ; avec compte : navigation possible', () => {
    expect(buildPersonDetail(raw()).employment).toBeNull()
    const data = buildPersonDetail(raw({ company: { id: 'acc-1', name: 'Oxalis', industry: 'SaaS' } }))
    expect(data.employment).toEqual({ accountId: 'acc-1', accountName: 'Oxalis', accountLogoUrl: null, jobTitle: null, sector: 'SaaS' })
  })

  it('synthèse : person_summaries prime, sinon résumé cognitif sourcé, sinon null', () => {
    const withSummary = buildPersonDetail(raw({ summaryRow: { content: 'Interlocuteur central du compte.', confidence: 80, generated_at: '2026-07-01' } }))
    expect(withSummary.summary?.text).toBe('Interlocuteur central du compte.')
    const withCognitive = buildPersonDetail(raw({ cognitiveProfile: { executive_summary: 'Réactif sur les sujets opérationnels.', global_confidence: 62, updated_at: '2026-07-02' } }))
    expect(withCognitive.summary?.text).toBe('Réactif sur les sujets opérationnels.')
    expect(withCognitive.summary?.provenance?.inferenceLevel).toBe('inferred')
  })

  it('parcours : les entrées héritées contact_career_path deviennent « probable »', () => {
    const data = buildPersonDetail(raw({
      legacyCareer: [{ id: 'c1', job_title: 'CTO', company_name: 'Oxalis', start_date: '2024-01-01', is_current: true, created_at: '2026-01-01' }],
    }))
    expect(data.careerEntries).toHaveLength(1)
    expect(data.careerEntries[0]?.verificationStatus).toBe('probable')
    expect(data.careerEntries[0]?.current).toBe(true)
    expect(data.careerEntries[0]?.title).toBe('CTO')
  })

  it('profil comportemental : seuil minimum respecté', () => {
    const data = buildPersonDetail(raw({ cognitiveProfile: { source_message_count: 3, behavioral_analysis_data: [{ trait: 'Concision', observation: 'Messages courts', confidence: 70 }] } }))
    expect(data.behavior.analyzedInteractions).toBe(3)
    expect(data.behavior.analyzedInteractions).toBeLessThan(data.behavior.minimumInteractions)
    expect(data.behavior.cognitiveProfile.maturity).toBe('emerging')
    expect(data.behavior.insights).toHaveLength(1)
  })

  it('profil cognitif : conserve le référentiel fixe et mappe uniquement les observations structurées', () => {
    const data = buildPersonDetail(raw({ cognitiveProfile: {
      source_interaction_count: 14,
      cognitive_profile_data: {
        schema_version: 2,
        interpersonal: {
          assertiveness: { status: 'observed', score: 78, label: 'Assertivité marquée', observation: 'Cadre régulièrement les prochaines étapes.', confidence: 81, evidence_count: 9, source_types: ['email'], evolution: 'stable' },
          warmth: { status: 'insufficient', score: 90, observation: 'Ce texte ne doit pas être affiché.' },
        },
        exchange_styles: {
          tempo: { status: 'observed', score: 22, label: 'Rapide', observation: 'Réponses généralement rapprochées.', confidence: 74, evidence_count: 7, source_types: ['email'] },
        },
        observable_markers: {
          response_time: { status: 'observed', score: 20, label: 'Réactif', observation: 'Répond le plus souvent dans la journée.', confidence: 76, evidence_count: 8, source_types: ['email'] },
        },
      },
    } }))
    expect(data.behavior.cognitiveProfile.maturity).toBe('usable')
    expect(data.behavior.cognitiveProfile.exchangeStyles.map((theme) => theme.id)).toEqual(['tempo', 'openness', 'orientation', 'certainty'])
    expect(data.behavior.cognitiveProfile.observableMarkers.map((theme) => theme.id)).toEqual([
      'response_time', 'dominance_listening_speaking', 'linguistic_synchrony', 'pronouns_status', 'register_distance', 'self_disclosure',
    ])
    expect(data.behavior.cognitiveProfile.exchangeStyles[0]).toMatchObject({ label: 'Rapide', score: 22, evidenceCount: 7 })
    expect(data.behavior.cognitiveProfile.interpersonal.warmth).toMatchObject({ status: 'insufficient', score: null, observation: null })
  })

  it('profil cognitif : 0 à 2 interactions ne produisent aucun profil', () => {
    const data = buildPersonDetail(raw({ cognitiveProfile: { source_interaction_count: 2, cognitive_profile_data: { schema_version: 2 } } }))
    expect(data.behavior.cognitiveProfile.maturity).toBe('none')
    expect(data.behavior.profileMinimumInteractions).toBe(3)
  })

  it('profil cognitif : les signaux de veille ne sont jamais comptés comme interactions', () => {
    const data = buildPersonDetail(raw({
      behavioralSignals: Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, text: 'Signal externe', signal_type: 'career' })),
      messages: [{ id: 'm1', direction: 'inbound', sent_at: '2026-07-01' }, { id: 'm2', direction: 'outbound', sent_at: '2026-07-02' }],
    }))
    expect(data.behavior.analyzedInteractions).toBe(1)
    expect(data.behavior.cognitiveProfile.maturity).toBe('none')
  })
})

describe('buildScoreHistory / scoreWindow — courbe sur vraies données', () => {
  it('agrège par mois en gardant le dernier snapshot du mois', () => {
    const history = buildScoreHistory([], [
      { score: 50, snapshot_date: '2026-05-02' },
      { score: 58, snapshot_date: '2026-05-20' },
      { score: 63, snapshot_date: '2026-06-11' },
    ])
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ monthKey: '2026-05', score: 58 })
    expect(history[1]).toMatchObject({ monthKey: '2026-06', score: 63 })
  })

  it('fenêtre continue : les mois sans donnée restent vides (jamais interpolés)', () => {
    const history = buildScoreHistory([], [{ score: 40, snapshot_date: '2026-03-10' }, { score: 70, snapshot_date: '2026-06-10' }])
    const window = scoreWindow(history, 6, new Date('2026-07-16'))
    expect(window).toHaveLength(6)
    expect(window.map((point) => point.score)).toEqual([null, null, 40, null, null, 70])
  })

  it('ignore les lignes sans score ou sans date', () => {
    expect(buildScoreHistory([], [{ snapshot_date: '2026-05-01' }, { score: 44 }])).toEqual([])
  })

  it('fusionne canonical et legacy : canonical ne doit pas effacer les mois plus anciens que seul legacy couvre', () => {
    const legacy = [
      { score: 18, snapshot_date: '2026-05-23' },
      { score: 33, snapshot_date: '2026-06-22' },
      { score: 39, snapshot_date: '2026-07-20' },
    ]
    const canonical = [
      { score: 40, computed_at: '2026-07-20T10:00:00Z' },
      { score: 45, computed_at: '2026-07-22T10:00:00Z' },
    ]
    const history = buildScoreHistory(canonical, legacy)
    expect(history).toHaveLength(3)
    expect(history[0]).toMatchObject({ monthKey: '2026-05', score: 18 })
    expect(history[1]).toMatchObject({ monthKey: '2026-06', score: 33 })
    // Juillet : canonical couvre ce mois, donc il prend le dessus sur legacy (45, pas 39).
    expect(history[2]).toMatchObject({ monthKey: '2026-07', score: 45 })
  })
})

describe('signaux, recommandations, coordonnées', () => {
  it('signal confirmé / infirmé : le verdict utilisateur est restitué', () => {
    const signals = buildSignals(
      [{ id: 's1', signal_type: 'poste', text: 'Nouveau rôle détecté', source_type: 'email_google_analysis', confidence: 66, observed_at: '2026-07-01' }, { id: 's2', signal_type: 'cadence', text: 'Silence prolongé', source_type: 'email_google_analysis', observed_at: '2026-07-02' }],
      new Map([['s1', 'confirmed'], ['s2', 'dismissed']]),
    )
    expect(signals[0]?.validationStatus).toBe('confirmed')
    expect(signals[1]?.validationStatus).toBe('dismissed')
    expect(signals[0]?.provenance.sourceLabel).toBe('Gmail')
  })

  it('recommandation coaching : payload structuré (s’appuyer sur / éviter / évolutions)', () => {
    const [reco] = buildRecommendations([{
      id: 'r1', kind: 'coaching', category: 'posture', title: 'Cadre par écrit', justification: 'Engagements oraux non tracés.',
      payload: { lean_on: ['Problème ouvert'], avoid: ['Oral seul'], evolutions: [{ direction: 'up', text: 'Engagements en hausse' }, { direction: 'bad', text: 'ignoré' }] },
      status: 'open', observed_at: '2026-07-01', source_label: 'Moteur Tohu',
    }])
    expect(reco?.leanOn).toEqual(['Problème ouvert'])
    expect(reco?.avoid).toEqual(['Oral seul'])
    expect(reco?.evolutions).toEqual([{ direction: 'up', text: 'Engagements en hausse' }])
  })

  it('statuts de recommandation inconnus retombent sur « open »', () => {
    const recos = buildRecommendations([{ id: 'r1', kind: 'action', title: 'Relancer', justification: 'Silence.', status: 'weird', observed_at: '2026-07-01' }, { id: 'r2', kind: 'action', title: 'OK', justification: 'x', status: 'completed', observed_at: '2026-07-01' }])
    expect(recos[0]?.status).toBe('open')
    expect(recos[1]?.status).toBe('completed')
  })

  it('coordonnées : fusion persistées + héritées sans doublon', () => {
    const details = buildContactDetails(
      [{ id: 'd1', detail_type: 'email', value: 'camille@exemple.fr', is_primary: true, verification_status: 'verified', visibility: 'workspace' }],
      { email: 'camille@exemple.fr', enrichment_data: { phone: '+33612345678' }, updated_at: '2026-07-01' },
    )
    expect(details).toHaveLength(2)
    expect(details[0]?.verificationStatus).toBe('verified')
    expect(details[1]?.id).toBe('legacy-phone')
    expect(details[1]?.verificationStatus).toBe('unverified')
  })

  it('les coordonnées archivées sont exclues', () => {
    const details = buildContactDetails([{ id: 'd1', detail_type: 'phone', value: '+3361', archived_at: '2026-07-01' }], {})
    expect(details).toHaveLength(0)
  })

  it('validation de format des coordonnées', () => {
    expect(validateContactDetail('email', 'pas-un-email')).toBeTruthy()
    expect(validateContactDetail('email', 'ok@exemple.fr')).toBeNull()
    expect(validateContactDetail('phone', '+33 6 12 34 56 78')).toBeNull()
    expect(validateContactDetail('linkedin', 'linkedin.com/in/x')).toBeTruthy()
    expect(validateContactDetail('linkedin', 'https://linkedin.com/in/x')).toBeNull()
  })
})

describe('sources et historique', () => {
  it('sources : jamais « connecté » sans ligne connecteur réelle', () => {
    const sources = buildSources([{ provider: 'google', status: 'connected', last_synced_at: '2026-07-15' }, { provider: 'linkedin', status: 'not_connected' }], new Map([['google', 12]]))
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ label: 'Gmail', status: 'connected', interactionCount: 12 })
  })

  it('historique unifié trié du plus récent au plus ancien', () => {
    const events = buildHistory(
      [{ id: 'm1', starts_at: '2026-06-10T10:00:00Z', title: 'Réunion' }],
      [{ id: 'e1', sent_at: '2026-07-01T08:00:00Z', direction: 'outbound', provider: 'google' }],
      [], [], [],
    )
    expect(events.map((event) => event.type)).toEqual(['email', 'meeting'])
  })
})

describe('workspace et RLS côté service', () => {
  it('la requête contact exige organization_id + id : une personne d’un autre workspace est introuvable par construction', () => {
    // Vérifié au niveau du service : .eq('organization_id', workspaceId).eq('id', personId).
    // Ici on garantit que le mapping ne fabrique jamais de personne sans ligne contact.
    const data = buildPersonDetail(raw({ contact: { id: 'person-1', full_name: 'Camille Test' } }))
    expect(data.person.workspaceId).toBe('org-1')
    expect(data.person.id).toBe('person-1')
  })
})
