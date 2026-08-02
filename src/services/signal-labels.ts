const RECENT_ACTIVITY_RULES: Array<[RegExp, string]> = [
  [/\b(nommé|nommée|nomination|désignation|promotion au|rejoint|prend la direction|devient)\b/i, 'Nomination détectée'],
  [/\b(retrait du poste|quitte|départ|démission|renonciation|cessation des fonctions|cesse ses fonctions)\b/i, 'Départ de fonction'],
  [/\b(levée|lève|capital|financement|investissement|investisseur|business angels?|revenus?)\b/i, 'Évolution du financement'],
  [/\b(partenariat|partenaire|collabore|collaboration|accord avec|adhésion)\b/i, 'Nouveau partenariat'],
  [/\b(acquisition|rachat|fusion|cession|liquidation|procédure collective)\b/i, 'Opération stratégique'],
  [/\b(lancement|lance|ouverture|nouvelle offre|offre spéciale|offre promotionnelle|product drop)\b/i, 'Lancement d’une offre'],
  [/\b(article|publication|publie|guide pratique)\b/i, 'Nouvelle publication'],
  [/\b(podcast|interview|prise de parole)\b/i, 'Nouvelle prise de parole'],
  [/\b(participation|salon|événement|event|conférence|webinaire|portes ouvertes|présence confirmée)\b/i, 'Participation à un événement'],
  [/\b(recrutement|recrute|poste à pourvoir|embauche)\b/i, 'Recrutement détecté'],
  [/\b(index égalité|équipe managériale|effectif|ressources humaines)\b/i, 'Actualité RH'],
  [/\b(réglement|obligation|arrêté|réforme|décret|loi|norme|entrée en vigueur|certificats d’économies d’énergie|cee)\b/i, 'Évolution réglementaire'],
  [/\b(email professionnel|coordonnées|adresse email)\b/i, 'Coordonnées professionnelles mises à jour'],
  [/\b(présence web|site web|site internet)\b/i, 'Présence en ligne détectée'],
  [/\b(contrat|client|chiffre d’affaires|revenu)\b/i, 'Information commerciale'],
  [/\b(prix|récompense|certification|agrément|label|statut de partenaire)\b/i, 'Reconnaissance obtenue'],
  [/\b(aucune activité|non disponible|n\/a)\b/i, 'Aucune actualité vérifiée'],
]

export function recentActivityTitle(text: unknown): string {
  const value = typeof text === 'string' ? text.trim() : ''
  for (const [pattern, title] of RECENT_ACTIVITY_RULES) {
    if (pattern.test(value)) return title
  }
  return 'Actualité récente'
}

/** Signaux issus de l'analyse comportementale (6 axes + marqueurs observables).
 *  Leur `inference` répète souvent la clé technique (« register_distance »),
 *  donc on ne fait jamais confiance à l'inférence brute pour ces types. */
const BEHAVIORAL_SIGNAL_TITLES: Record<string, string> = {
  rythme: 'Rythme d’échange',
  argumentation: 'Style d’argumentation',
  engagement: 'Engagements formulés',
  registre: 'Registre de langage',
  register_distance: 'Registre & distance',
  tonalite: 'Tonalité relationnelle',
  espace_parole: 'Espace de parole',
  response_time: 'Temps de réponse',
  dominance_listening_speaking: 'Écoute et prise de parole',
  linguistic_synchrony: 'Synchronie linguistique',
  pronouns_status: 'Usage des pronoms',
  self_disclosure: 'Auto-divulgation',
  mobility: 'Mobilité professionnelle',
}

const BEHAVIORAL_SIGNAL_CATEGORY: Record<string, string> = {
  rythme: 'Style d’échange', espace_parole: 'Style d’échange', response_time: 'Style d’échange',
  dominance_listening_speaking: 'Style d’échange', linguistic_synchrony: 'Style d’échange',
  argumentation: 'Posture', engagement: 'Posture',
  registre: 'Communication', register_distance: 'Communication', tonalite: 'Communication',
  pronouns_status: 'Communication', self_disclosure: 'Communication',
  mobility: 'Mouvement',
}

/** Vrai pour les signaux d'analyse comportementale (à ne pas afficher comme
 *  « actualité depuis le dernier échange »). */
export function isBehavioralSignal(signalType: unknown): boolean {
  return String(signalType || '').toLowerCase() in BEHAVIORAL_SIGNAL_TITLES
}

/** « register_distance » n'est pas un titre lisible : capitalise et enlève les
 *  underscores, en dernier recours seulement. */
function humanize(value: string): string {
  const spaced = value.replaceAll('_', ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Signal'
}

/** Une inférence n'est exploitable comme titre que si ce n'est pas une clé technique
 *  (tout en minuscules/underscores, sans espace ni accent). */
function isRawSlug(value: string): boolean {
  return /^[a-z]+(_[a-z]+)*$/.test(value)
}

export function signalTitle(signalType: unknown, inference: unknown, text: unknown): string {
  const type = String(signalType || '').toLowerCase()
  if (type === 'recent_activity') {
    const explicit = typeof inference === 'string' ? inference.trim() : ''
    return explicit && explicit.toLowerCase() !== 'recent_activity' ? explicit : recentActivityTitle(text)
  }
  if (BEHAVIORAL_SIGNAL_TITLES[type]) return BEHAVIORAL_SIGNAL_TITLES[type]
  const explicit = typeof inference === 'string' ? inference.trim() : ''
  if (explicit && !isRawSlug(explicit)) return explicit
  return humanize(String(signalType || 'Signal comportemental'))
}

export function signalTypeLabel(signalType: unknown): string {
  const value = String(signalType || '').toLowerCase()
  if (BEHAVIORAL_SIGNAL_CATEGORY[value]) return BEHAVIORAL_SIGNAL_CATEGORY[value]
  const labels: Record<string, string> = {
    recent_activity: 'Actualité',
    job_change: 'Mouvement',
    tone: 'Communication',
    deadline: 'Échéance',
    governance: 'Gouvernance',
    news: 'Actualité',
    silence: 'Relation',
  }
  return labels[value] ?? humanize(String(signalType || 'Signal'))
}
