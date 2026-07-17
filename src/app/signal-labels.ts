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

export function signalTitle(signalType: unknown, inference: unknown, text: unknown): string {
  const explicit = typeof inference === 'string' ? inference.trim() : ''
  if (explicit && explicit.toLowerCase() !== 'recent_activity') return explicit
  if (String(signalType).toLowerCase() === 'recent_activity') return recentActivityTitle(text)
  return String(signalType || 'Signal comportemental').replaceAll('_', ' ')
}

export function signalTypeLabel(signalType: unknown): string {
  const value = String(signalType || '').toLowerCase()
  const labels: Record<string, string> = {
    recent_activity: 'Actualité',
    job_change: 'Mouvement',
    tone: 'Communication',
    deadline: 'Échéance',
    governance: 'Gouvernance',
    news: 'Actualité',
    silence: 'Relation',
  }
  return labels[value] ?? String(signalType || 'Signal').replaceAll('_', ' ')
}
