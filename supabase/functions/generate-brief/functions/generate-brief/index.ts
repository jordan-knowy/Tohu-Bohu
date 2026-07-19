import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';

// ── System prompt (doc 06 v3) ────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es le moteur d'intelligence interactionnelle de Knowr.
Tu génères des briefs pré-meeting ultra-précis, stratégiquement actionnables et scientifiquement fondés.

RÈGLE N°1 — ZÉRO HALLUCINATION
Toute donnée sans source = null. Jamais inventé.

RÈGLE N°2 — ANALYSE PAR CHOIX DE VIE
Profil comportemental depuis les décisions observables, jamais le titre.

RÈGLE N°3 — HIÉRARCHIE DES SOURCES
Mémoire Knowr > Interne (emails/calendar) > Externe vérifiable > Externe inférentiel.

RÈGLE N°4 — NIVEAUX D'INFÉRENCE
Observable / Inféré / Hypothétique / Non disponible — afficher toujours.

RÈGLE N°5 — OBJECTIONS OBLIGATOIRES
Section O jamais vide. Minimum 1. Chaque objection avec levier Cialdini.

RÈGLE N°6 — JTBD OBLIGATOIRE
Section F : 3 dimensions (fonctionnel/social/émotionnel) + JTBD organisationnel si données.

RÈGLE N°7 — SENSEMAKING SI CHAMPION ≠ DÉCIDEUR
Section P obligatoire si Champion ≠ décideur. Script de vente interne en 2 phrases.

RÈGLE N°8 — LEVIERS D'INFLUENCE SOURCÉS
Section L : 2-3 leviers Cialdini forts. Jamais d'urgence artificielle.

RÈGLE N°9 — MODE COGNITIF S1/S2
Section D : mode cognitif détecté. Format pitch adapté (storytelling vs données).

RÈGLE N°10 — ANTI-RÉPÉTITION
Une information dans une section ne se répète pas ailleurs.

FRAMEWORKS INTÉGRÉS :
- Cialdini (7 principes d'influence) → Section L
- Burt (structural holes / position réseau) → Section C
- Kahneman S1/S2 → Section D
- Christensen JTBD → Section F
- Weick Sensemaking → Section P
- French & Raven (bases du pouvoir) → Section C
- Slovic (perception du risque) → Section K

STRUCTURE DU BRIEF À GÉNÉRER (format JSON strict) :

{
  "meta": {
    "brief_id": "<uuid>",
    "generated_at": "<iso datetime>",
    "brief_type": "commercial|partenariat|productivite",
    "global_confidence": <0.0-1.0>,
    "sources_connected": ["gmail", "calendar", ...],
    "sources_missing": [{"source": "crm", "confidence_gain_if_connected": 0.15}]
  },
  "express": {
    "key_insight": "<1 phrase — insight le plus important>",
    "priority_action": "<1 phrase — action concrète>",
    "main_risk": "<1 phrase — risque principal>",
    "opening_question": "<question d'ouverture exacte, prête à dire — = '1ère phrase à dire'>",
    "interaction_modes_primary": ["challenger|validator|strategist|operator|consensus_builder|explorer"],
    "expectation": "<ce que l'interlocuteur attend de ce RDV, 1 phrase>",
    "to_obtain": "<ce qu'il faut OBTENIR concrètement de ce RDV>",
    "anti_pattern": "<le piège à éviter absolument pendant ce RDV>",
    "success_signal": "<le signal observable qui prouvera que le RDV est réussi>"
  },
  "objectives": {
    "minimal": "<succès minimal — le strict nécessaire à décrocher>",
    "nominal": "<objectif nominal — le résultat visé>",
    "stretch": "<stretch goal — le meilleur scénario réaliste>"
  },
  "spin_questions": [
    {"type": "situation|problem|implication|need_payoff", "question": "<question exacte à poser, prête à dire>", "rationale": "<ce qu'elle fait émerger>"}
  ],
  "pivots": [
    {"signal": "<phrase/objection que l'interlocuteur pourrait dire>", "script": "<réponse exacte à dire pour rebondir>", "goal": "<ce que ce pivot cherche à obtenir>"}
  ],
  "why_now": {
    "signal_verbatim": "<verbatim du signal d'achat, entre guillemets, si observable — sinon null>",
    "date": "<date du signal | null>",
    "source": "<source | null>",
    "interpretation": "<pourquoi c'est le bon moment, 1-2 phrases>"
  },
  "recommended_action": {
    "type": "send_email|book_meeting|wait|call|null",
    "label": "<libellé court de l'action, ex. 'Envoyer un mail'>",
    "rationale": "<pourquoi le moteur recommande ça maintenant>",
    "email_recipient": "<email destinataire | null>",
    "email_subject": "<objet du mail prêt à envoyer | null>",
    "email_body": "<corps du mail personnalisé, prêt à envoyer, ancré sur le signal | null>"
  },
  "context": {
    "executive_summary": {
      "text": "<3-5 phrases style éditorial>",
      "status_tags": [{"label": "...", "type": "positive|warning|negative|info"}],
      "sources": ["calendar", "gmail"]
    },
    "company_context": {
      "name": "<string|null>",
      "sector": "<string|null>",
      "size": "<string|null>",
      "framing_context": "growth_mode|efficiency_mode|survival_mode|transition_mode|unavailable",
      "timeline_events": [{"event": "...", "date": "...", "impact": "positive|neutral|negative", "source": "..."}]
    }
  },
  "people": {
    "participants": [
      {
        "name": "<string>",
        "title": "<string|null>",
        "company": "<string|null>",
        "role_real": "decision_maker|champion|sponsor|gatekeeper|blocker|influencer|user|unknown",
        "role_real_confidence": <0.0-1.0>,
        "influence_score": <1-5|null>,
        "network_position": "broker|central|peripheral|unavailable",
        "is_primary_profile": <boolean>
      }
    ],
    "primary_profile": {
      "participant_ref": "<nom>",
      "interactional_profile": {
        "axis_result_relation": <0-100|null>,
        "axis_result_relation_level": "observable|inferred|hypothetical|unavailable",
        "axis_structure_intuition": <0-100|null>,
        "axis_structure_intuition_level": "observable|inferred|hypothetical|unavailable",
        "axis_speed_caution": <0-100|null>,
        "axis_speed_caution_level": "observable|inferred|hypothetical|unavailable",
        "axis_control_consensus": <0-100|null>,
        "axis_control_consensus_level": "observable|inferred|hypothetical|unavailable",
        "cognitive_mode": "s1_dominant|s2_dominant|contextual|unavailable",
        "cognitive_mode_confidence": <0.0-1.0>,
        "interaction_modes_primary": ["<mode>"],
        "pitch_format_recommendation": "<string|null>"
      },
      "behavioral_analysis": [
        {
          "signal": "<signal observable>",
          "inference": "<inférence>",
          "source": "<source>",
          "level": "observable|inferred|hypothetical",
          "confidence": <0.0-1.0>
        }
      ],
      "jtbd_analysis": {
        "functional_job": "<string|null>",
        "functional_job_confidence": <0.0-1.0|null>,
        "functional_pitch_angle": "<string|null>",
        "social_job": "<string|null>",
        "social_job_confidence": <0.0-1.0|null>,
        "social_pitch_angle": "<string|null>",
        "emotional_job": "<string|null>",
        "emotional_job_confidence": <0.0-1.0|null>,
        "emotional_pitch_angle": "<string|null>",
        "jtbd_qualify_question": "<string|null>"
      },
      "theory_of_mind": {
        "perceived_positioning": "<string|null>",
        "likely_skepticism_areas": "<string|null>",
        "credibility_gaps": "<string|null>",
        "knows": ["<ce qu'il/elle SAIT déjà — faits acquis>"],
        "doesnt_know": ["<ce qu'il/elle NE SAIT PAS encore — à révéler>"],
        "believes": ["<ce qu'il/elle CROIT probablement (à recadrer)>"],
        "mood": "<humeur probable à l'entrée du RDV, 1 phrase | null>",
        "risk": "<le risque de perception principal + comment le cadrer | null>",
        "confidence": <0.0-1.0|null>
      }
    }
  },
  "deal": {
    "meddpicc": {
      "health_score": <0-8|null>,
      "metrics": {"value": "<string|null>", "level": "observable|inferred|hypothetical|unavailable", "confidence": <0.0-1.0|null>, "sources": []},
      "economic_buyer": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []},
      "decision_criteria": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []},
      "decision_process": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []},
      "paper_process": {"value": "<string|null — modalités contractuelles/achat>", "level": "...", "confidence": null, "sources": []},
      "identify_pain": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []},
      "champion": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []},
      "competition": {"value": "<string|null>", "level": "...", "confidence": null, "sources": []}
    },
    "cost_of_inaction": {
      "framing_type": "loss_aversion|opportunity_cost|competitive_risk|null",
      "loss_framing_statement": "<string|null>",
      "opportunity_window": "open|closing|closed|uncertain|null",
      "confidence": <0.0-1.0|null>
    },
    "influence_levers": {
      "reciprocity": {"strength": "very_high|high|medium|low|not_activatable|negative", "evidence": "<string|null>", "recommendation": "<string|null>", "example_phrase": "<string|null>", "confidence": <0.0-1.0|null>},
      "commitment_consistency": {"strength": "...", "public_position": "<string|null>", "recommendation": "<string|null>", "example_phrase": "<string|null>", "confidence": null},
      "social_proof": {"strength": "...", "recommendation": "<string|null>", "confidence": null},
      "authority": {"strength": "...", "authority_type": "data_analytical|practitioner|academic|null", "recommendation": "<string|null>", "confidence": null},
      "liking": {"strength": "...", "connection_points": [], "recommendation": "<string|null>", "confidence": null},
      "scarcity": {"strength": "...", "genuine_urgency_signal": "<string|null>", "artificial_urgency_blocked": false, "recommendation": "<string|null>", "confidence": null},
      "unity": {"strength": "...", "shared_identity": "<string|null>", "recommendation": "<string|null>", "confidence": null},
      "top_levers_summary": [{"principle": "...", "strength": "...", "one_line_recommendation": "..."}]
    }
  },
  "action": {
    "recommendations": [
      {"order": 1, "phase": "<phase temporelle>", "action": "<action concrète>", "rationale": "<ancré sur signal>", "source_signal": "<string|null>", "influence_lever_used": "<string|null>", "adapted_for_cognitive_mode": "<string|null>"}
    ],
    "objections": [
      {"verbatim": "<comme ils le diraient>", "probability": <0.0-1.0>, "objection_type": "...", "source_signal": "...", "prepared_response": "...", "anti_pattern": "<l'erreur à NE PAS faire face à cette objection>", "cialdini_lever_to_activate": "<string|null>"}
    ],
    "internal_selling": null,
    "risks": [
      {"title": "...", "level": "high|medium|low", "description": "...", "mitigation": "<string|null>"}
    ],
    "next_steps": [
      {"action": "...", "timing": "in_meeting|j_plus_1|j_plus_7|post_meeting", "priority": "mandatory|priority_1|optional", "assignee": "<string|null>"}
    ]
  }
}

RÈGLES SECTIONS RÉUNION (maquette de référence) :
- express : remplir expectation / to_obtain / anti_pattern / success_signal — concrets, jamais génériques. opening_question = la 1ère phrase exacte à dire.
- objectives : TOUJOURS 3 tiers (minimal / nominal / stretch), réalistes et mesurables.
- spin_questions : 3 questions minimum (situation/problem, implication, need_payoff), formulées prêtes à dire, ancrées sur le contexte réel (signaux, échanges). Pas de questions génériques.
- theory_of_mind : remplir knows / doesnt_know / believes (listes courtes) + mood + risk depuis les signaux observables. Si peu de données → listes plus courtes, jamais inventées.
- pivots : 2-3 pivots (signal probable → script de réponse → but). Ancrés sur les objections/signaux réels.
- why_now : si un signal d'achat existe (verbatim email/observable), le citer mot pour mot + date + source. Sinon interpretation prudente, verbatim=null.
- recommended_action : UNE action que « le moteur a tranché ». Si un mail est pertinent (perche chaude, pas de RDV calé), type=send_email + email_subject + email_body personnalisés et prêts (signature à ajouter côté app). Sinon book_meeting/call/wait.
- objections : chaque objection a prepared_response ET anti_pattern.

ANTI-PATTERNS INTERDITS :
- MEDDPICC complet inventé → null sur chaque case
- Urgence artificielle → jamais
- Section Objections vide → minimum 1 obligatoire
- Profil interactionnel sans niveau d'inférence → interdit
- Analyse comportementale depuis le titre → jamais
- JTBD générique → null si pas de signal
- spin_questions / objectives génériques (copiables sur n'importe quel deal) → interdit, ancrer sur le réel`;

// ── Build context for the LLM ────────────────────────────────────────────────
function buildUserMessage(ctx: BriefContext): string {
  const lines: string[] = ['=== CONTEXTE KNOWY POUR LA GÉNÉRATION DU BRIEF ===\n'];

  lines.push(`RÉUNION : "${ctx.meeting.title}"`);
  lines.push(`Date : ${ctx.meeting.starts_at ? new Date(ctx.meeting.starts_at).toLocaleString('fr-FR') : 'Non précisée'}`);
  if (ctx.meeting.company) lines.push(`Entreprise cliente : ${ctx.meeting.company}`);
  if (ctx.meeting.location) lines.push(`Lieu/format : ${ctx.meeting.location}`);

  lines.push('\n=== PARTICIPANTS ===');
  for (const p of ctx.participants) {
    lines.push(`\n• ${p.display_name || p.email}`);
    if (p.email) lines.push(`  Email : ${p.email}`);
    if (p.contact) {
      if (p.contact.role_title) lines.push(`  Titre : ${p.contact.role_title}`);
      if (p.contact.company_name) lines.push(`  Entreprise : ${p.contact.company_name}`);
      if (p.contact.linkedin_url) lines.push(`  LinkedIn : ${p.contact.linkedin_url}`);
      if (p.contact.tenure_start_date) lines.push(`  Dans le poste depuis : ${p.contact.tenure_start_date}`);
    }
    if (p.snapshot) {
      lines.push(`  Score d'engagement Knowr : ${p.snapshot.engagement_score}/100`);
      lines.push(`  Phase relationnelle : ${p.snapshot.phase} (évolution : ${p.snapshot.score_evolution > 0 ? '+' : ''}${p.snapshot.score_evolution} pts/30j)`);
      if (p.snapshot.last_contact_at) {
        const daysAgo = Math.round((Date.now() - new Date(p.snapshot.last_contact_at).getTime()) / 86400000);
        lines.push(`  Dernier contact : il y a ${daysAgo} jours (${p.snapshot.last_contact_type || 'type inconnu'})`);
      }
      if (p.snapshot.reciprocity_pct != null) {
        lines.push(`  Réciprocité : ${p.snapshot.reciprocity_pct}% (50% = équilibre parfait)`);
      }
    }
  }

  if (ctx.communications.length > 0) {
    lines.push('\n=== HISTORIQUE DES ÉCHANGES (métadonnées uniquement) ===');
    const byContact: Record<string, typeof ctx.communications> = {};
    for (const c of ctx.communications) {
      const key = c.contact_email || 'inconnu';
      if (!byContact[key]) byContact[key] = [];
      byContact[key].push(c);
    }
    for (const [email, msgs] of Object.entries(byContact)) {
      const sent = msgs.filter(m => m.direction === 'outbound').length;
      const received = msgs.filter(m => m.direction === 'inbound').length;
      const threads = new Set(msgs.map(m => m.thread_subject).filter(Boolean));
      lines.push(`\n${email} :`);
      lines.push(`  ${msgs.length} échanges (${sent} envoyés, ${received} reçus)`);
      if (threads.size > 0) {
        const subjects = Array.from(threads).slice(0, 3);
        lines.push(`  Sujets récents : ${subjects.join(' | ')}`);
      }
      const avgResponseHours = msgs.filter(m => m.response_time_hours != null)
        .reduce((sum, m) => sum + (m.response_time_hours || 0), 0) /
        Math.max(1, msgs.filter(m => m.response_time_hours != null).length);
      if (isFinite(avgResponseHours) && avgResponseHours > 0) {
        lines.push(`  Temps de réponse moyen : ${Math.round(avgResponseHours)}h`);
      }
    }
  }

  if (ctx.signals.length > 0) {
    lines.push('\n=== SIGNAUX COMPORTEMENTAUX (cognitive_profiles) ===');
    for (const s of ctx.signals.slice(0, 10)) {
      lines.push(`• [${s.inference_level.toUpperCase()} · conf.${Math.round(s.confidence)}%] ${s.text}`);
      if (s.inference) lines.push(`  → ${s.inference}`);
      lines.push(`  Source : ${s.source_type}${s.observed_at ? ` | ${new Date(s.observed_at).toLocaleDateString('fr-FR')}` : ''}`);
    }
  }

  if (ctx.profile) {
    lines.push('\n=== PROFIL COGNITIF EXISTANT ===');
    lines.push(`Confiance globale : ${ctx.profile.global_confidence}%`);
    if (ctx.profile.summary) lines.push(`Résumé : ${ctx.profile.summary}`);
    if (ctx.profile.axes?.length) {
      lines.push('Axes interactionnels :');
      for (const ax of ctx.profile.axes) {
        lines.push(`  ${ax.axis} : ${ax.value}/100 [${ax.inference_level} · conf.${Math.round(ax.confidence)}%]`);
      }
    }
  }

  lines.push(`\n=== SOURCES DISPONIBLES ===`);
  lines.push(`Connectées : ${ctx.sources_connected.join(', ') || 'aucune'}`);
  lines.push(`Manquantes : ${ctx.sources_missing.join(', ') || 'aucune'}`);

  lines.push('\n=== INSTRUCTION ===');
  lines.push('Génère le brief commercial complet en JSON valide selon la structure définie dans le system prompt.');
  lines.push('Remplace "<uuid>" par un UUID valide. Utilise uniquement les données ci-dessus, jamais de données inventées.');
  lines.push('Si une donnée est absente, mets null. Si une section est vide de signaux, indique le niveau "unavailable".');

  return lines.join('\n');
}

interface BriefContext {
  meeting: Record<string, any>;
  participants: Array<{
    display_name: string | null;
    email: string | null;
    contact: Record<string, any> | null;
    snapshot: Record<string, any> | null;
  }>;
  communications: Array<Record<string, any>>;
  signals: Array<Record<string, any>>;
  profile: Record<string, any> | null;
  sources_connected: string[];
  sources_missing: string[];
}

// ── Edge function ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { organizationId, meetingId, forceRefresh = false } = body;

  if (!organizationId || !meetingId) {
    return jsonResponse({ error: 'organizationId and meetingId are required' }, 400);
  }

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!openrouterKey) return jsonResponse({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  // Check existing brief unless forceRefresh
  if (!forceRefresh) {
    const { data: existing } = await supabase
      .from('briefs')
      .select('id, status, content, updated_at')
      .eq('organization_id', organizationId)
      .eq('meeting_id', meetingId)
      .eq('status', 'ready')
      .maybeSingle();

    if (existing) {
      return jsonResponse({ briefId: existing.id, meetingId, status: 'ready', content: existing.content });
    }
  }

  // Mark as generating
  await supabase.from('meetings').update({ brief_status: 'generating' }).eq('id', meetingId);

  try {
    // ── 1. Fetch meeting ──────────────────────────────────────────────────
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    if (!meeting) {
      await supabase.from('meetings').update({ brief_status: 'failed' }).eq('id', meetingId);
      return jsonResponse({ error: 'Meeting not found' }, 404);
    }

    // ── 2. Fetch participants ─────────────────────────────────────────────
    const { data: rawParticipants } = await supabase
      .from('meeting_participants')
      .select('id, email, display_name, contact_id, is_current_user')
      .eq('meeting_id', meetingId)
      .eq('is_current_user', false);

    const participants: BriefContext['participants'] = [];
    const primaryContactId = rawParticipants?.[0]?.contact_id;

    for (const p of rawParticipants || []) {
      let contact = null;
      let snapshot = null;

      if (p.contact_id) {
        const { data: c } = await supabase
          .from('contacts')
          .select('full_name, role_title, email, linkedin_url, avatar_url, tenure_start_date, company_id, source_summary, companies(name)')
          .eq('id', p.contact_id)
          .maybeSingle();
        if (c) {
          contact = { ...c, company_name: (c.companies as any)?.name ?? c.source_summary?.company ?? '' };
        }

        const { data: snap } = await supabase
          .from('relationship_snapshots')
          .select('engagement_score, score_evolution, phase, last_contact_at, last_contact_type, reciprocity_pct')
          .eq('organization_id', organizationId)
          .eq('contact_id', p.contact_id)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        snapshot = snap;
      }

      participants.push({
        display_name: p.display_name,
        email: p.email,
        contact,
        snapshot,
      });
    }

    // ── 3. Fetch communication history ────────────────────────────────────
    const contactEmails = participants.map(p => p.email).filter(Boolean);
    let communications: BriefContext['communications'] = [];

    if (contactEmails.length > 0) {
      const { data: msgs } = await supabase
        .from('communication_messages')
        .select('direction, sent_at, metadata, thread_id')
        .eq('organization_id', organizationId)
        .in('contact_id', rawParticipants?.map(p => p.contact_id).filter(Boolean) || [])
        .order('sent_at', { ascending: false })
        .limit(50);

      if (msgs?.length) {
        // Get thread subjects
        const threadIds = [...new Set(msgs.map(m => m.thread_id).filter(Boolean))];
        const { data: threads } = await supabase
          .from('communication_threads')
          .select('id, subject')
          .in('id', threadIds);

        const threadMap = new Map((threads || []).map(t => [t.id, t.subject]));

        // Build contact email map
        const contactEmailMap = new Map(
          (rawParticipants || []).filter(p => p.contact_id).map(p => [p.contact_id, p.email])
        );

        for (const m of msgs) {
          const contactId = (m.metadata as any)?.contact_id;
          communications.push({
            direction: m.direction,
            sent_at: m.sent_at,
            thread_subject: m.thread_id ? threadMap.get(m.thread_id) : null,
            contact_email: contactId ? contactEmailMap.get(contactId) : null,
            response_time_hours: (m.metadata as any)?.response_time_hours ?? null,
          });
        }
      }
    }

    // ── 4. Fetch behavioral signals ───────────────────────────────────────
    let signals: BriefContext['signals'] = [];
    let profile: BriefContext['profile'] = null;

    if (primaryContactId) {
      const { data: prof } = await supabase
        .from('cognitive_profiles')
        .select('global_confidence, summary, updated_from')
        .eq('organization_id', organizationId)
        .eq('contact_id', primaryContactId)
        .order('profile_version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prof) {
        const { data: axes } = await supabase
          .from('interaction_axis_scores')
          .select('axis, value, confidence, inference_level')
          .eq('organization_id', organizationId);

        profile = { ...prof, axes: axes || [] };

        const { data: sigs } = await supabase
          .from('behavioral_signals')
          .select('signal_type, text, inference, inference_level, confidence, source_type, observed_at')
          .eq('organization_id', organizationId)
          .eq('contact_id', primaryContactId)
          .order('created_at', { ascending: false })
          .limit(15);

        signals = (sigs || []).map(s => ({ ...s, text: s.text, inference: s.inference }));
      }
    }

    // ── 5. Build context ──────────────────────────────────────────────────
    const sources_connected: string[] = ['calendar'];
    if (communications.length > 0) sources_connected.push('gmail');
    if (profile) sources_connected.push('knowy_memory');

    const sources_missing: string[] = [];
    if (communications.length === 0) sources_missing.push('gmail');
    if (!profile) sources_missing.push('knowy_memory');

    const ctx: BriefContext = {
      meeting,
      participants,
      communications,
      signals,
      profile,
      sources_connected,
      sources_missing,
    };

    // ── 6. Call OpenRouter (Gemini 2.5) ──────────────────────────────────
    const userMessage = buildUserMessage(ctx);

    const llmRes = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://knowy-ai.netlify.app',
        'X-Title': 'Knowr Brief Engine',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('OpenRouter API error:', llmRes.status, errText);
      await supabase.from('meetings').update({ brief_status: 'failed' }).eq('id', meetingId);
      return jsonResponse({ error: `LLM error: ${llmRes.status}` }, 502);
    }

    const llmData = await llmRes.json();
    const rawContent = llmData.choices?.[0]?.message?.content ?? '';

    // Extract JSON from the response
    let briefJson: Record<string, any> = {};
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) ||
                        rawContent.match(/```\s*([\s\S]*?)```/) ||
                        [null, rawContent];
      briefJson = JSON.parse(jsonMatch[1]?.trim() ?? rawContent.trim());
    } catch {
      // If parsing fails, store raw content
      briefJson = { raw: rawContent, parse_error: true };
    }

    // Determine confidence score from brief
    const confidenceScore = briefJson?.meta?.global_confidence != null
      ? Math.round(briefJson.meta.global_confidence * 100)
      : 30;

    // ── 7. Store brief ────────────────────────────────────────────────────
    // Determine brief type from meeting
    const briefType = meeting.meeting_type === 'internal' ? 'productivite'
      : meeting.meeting_type === 'partnership' ? 'partenariat'
      : 'commercial';

    const { data: storedBrief } = await supabase
      .from('briefs')
      .insert({
        organization_id: organizationId,
        meeting_id: meetingId,
        brief_type: briefType,
        status: 'ready',
        confidence_score: confidenceScore,
        content: briefJson,
        sources: sources_connected.map(s => ({ source: s })),
      })
      .select('id')
      .single();

    // Update meeting brief_status
    await supabase.from('meetings').update({ brief_status: 'ready' }).eq('id', meetingId);

    return jsonResponse({
      briefId: storedBrief?.id ?? null,
      meetingId,
      status: 'ready',
      confidenceScore,
      content: briefJson,
    });

  } catch (err) {
    console.error('generate-brief error:', err);
    await supabase.from('meetings').update({ brief_status: 'failed' }).eq('id', meetingId);
    return jsonResponse({ error: 'Internal error', detail: String(err) }, 500);
  }
});

