/**
 * Découpe la réponse texte de Bohu (titres `### Titre`, listes `- item`,
 * faits `**Label :** valeur`, gras `**mot**`) en sections typées pour un
 * rendu structuré (résumé / points clés / pourquoi / recommandations /
 * sources) — aucune dépendance markdown, le contrat de titres reste
 * volontairement simple et tolérant : une réponse sans titre retombe sur une
 * unique section "lead" (texte brut, comportement actuel).
 */

export type AskSectionKind = 'lead' | 'points' | 'why' | 'recommend' | 'sources' | 'text'
export type AskFact = { label: string; value: string }
export type AskSection = { kind: AskSectionKind; heading: string | null; facts: AskFact[]; paragraphs: string[]; items: string[] }

function classify(heading: string): AskSectionKind {
  const h = heading.toLowerCase()
  if (/résum|resum|synthès|synthes/.test(h)) return 'lead'
  if (/points?\s*cl/.test(h)) return 'points'
  if (/pourquoi/.test(h)) return 'why'
  if (/recommand|action|prochaine/.test(h)) return 'recommend'
  if (/source|preuve/.test(h)) return 'sources'
  return 'text'
}

export function parseBohuAnswer(raw: string): AskSection[] {
  const sections: AskSection[] = []
  let current: AskSection = { kind: 'lead', heading: null, facts: [], paragraphs: [], items: [] }
  const commit = () => { if (current.facts.length || current.paragraphs.length || current.items.length) sections.push(current) }
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    const heading = /^#{2,4}\s+(.+)/.exec(line)
    if (heading) {
      commit()
      current = { kind: classify(heading[1]!), heading: heading[1]!, facts: [], paragraphs: [], items: [] }
      continue
    }
    const fact = /^\*\*([^*:：]+)\s*[:：]\*\*\s*(.+)/.exec(line)
    if (fact) { current.facts.push({ label: fact[1]!.trim(), value: fact[2]!.trim() }); continue }
    const item = /^[-*]\s+(.+)/.exec(line)
    if (item) { current.items.push(item[1]!); continue }
    if (line) current.paragraphs.push(line)
  }
  commit()
  return sections.length ? sections : [{ kind: 'lead', heading: null, facts: [], paragraphs: [raw.trim()], items: [] }]
}

/** Segmente un texte en tokens gras/normal (`**mot**`) pour un rendu <strong> ciblé. */
export type InlineToken = { bold: boolean; text: string }

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    if (match.index > last) tokens.push({ bold: false, text: text.slice(last, match.index) })
    tokens.push({ bold: true, text: match[1]! })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({ bold: false, text: text.slice(last) })
  return tokens.length ? tokens : [{ bold: false, text }]
}
