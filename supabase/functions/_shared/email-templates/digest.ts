// Rendu du digest hebdomadaire sur le layout partagé (blanc · 680 · épuré).
// Piloté par données typées ; `SAMPLE_DIGEST` sert au mode test.
import { EPI, MONO, C, esc, sectionLabel, rule, row, emailShell } from './layout.ts'

export type DigestMeeting = { day: string; time: string; who: string; sub: string; badge: string; badgeKind: 'ready' | 'first' | 'out' }
export type DigestAccount = { name: string; note: string; score: number; delta: number }
export type DigestHighlight = { kind: 'ok' | 'warn'; text: string; when: string }
export type DigestWatch = { tag: string; tagColor: 'red' | 'green' | 'blue'; text: string; source: string }
export type DigestData = {
  subject: string
  preheader: string
  periodLabel: string
  headline: string
  dashboardUrl: string
  weekAhead: DigestMeeting[]
  weekAheadNote: string
  nps: { value: number; delta: number; weeks: number; accounts: number }
  warming: DigestAccount[]
  declining: DigestAccount[]
  engagements: {
    slipped: Array<{ account: string; label: string; since: string }>; slippedDelta: number
    inProgress: string[]; inProgressNote: string
    validated: string[]; validatedDelta: number
    openTotal: number
  }
  highlights: DigestHighlight[]
  watch: DigestWatch[]
  watchNote: string
  cadenceNote: string
  computedNote: string
}

const BADGE: Record<DigestMeeting['badgeKind'], string> = {
  ready: `color:${C.green};background:#EDF8F2;`,
  first: `color:${C.violet};background:${C.lav};`,
  out: `color:${C.faint};background:#F3F1F8;`,
}
const WATCH_COLOR: Record<DigestWatch['tagColor'], string> = {
  red: `color:${C.red};background:#FDEFF1;`, green: `color:${C.green};background:#EDF8F2;`, blue: `color:${C.teal};background:#EAF6F8;`,
}

function bar(height: number, color: string, gap = 1): string {
  return `<td valign="bottom" style="padding:0 ${gap}px 0 0;"><div style="height:${height}px;line-height:${height}px;font-size:0;background-color:${color};border-radius:2px;">&nbsp;</div></td>`
}
function meetingRow(m: DigestMeeting): string {
  return `<tr><td style="padding-bottom:8px;"><table role="presentation" width="100%" style="background:${C.lav};border-radius:10px;"><tr>
    <td width="66" valign="middle" style="padding:12px 0 12px 14px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:.8px;color:${C.muted};">${esc(m.day)} ${esc(m.time)}</td>
    <td valign="middle" style="padding:12px 8px;font-family:${EPI};font-size:14px;font-weight:700;color:${C.ink};">${esc(m.who)}<div style="font-size:12px;font-weight:400;color:${C.muted};padding-top:2px;">${esc(m.sub)}</div></td>
    <td align="right" valign="middle" style="padding:12px 14px 12px 4px;white-space:nowrap;"><span style="display:inline-block;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;${BADGE[m.badgeKind]}padding:4px 8px;border-radius:6px;">${esc(m.badge)}</span></td>
  </tr></table></td></tr>`
}
function accountRow(a: DigestAccount, positive: boolean): string {
  const color = positive ? C.green : C.red
  const arrow = positive ? '&#9650;+' : '&#9660;&minus;'
  const heights = positive ? [4, 6, 5, 8, 7, 10, 9, 13, 12, 15, 14, 20] : [20, 19, 17, 18, 16, 15, 13, 12, 10, 8, 6, 4]
  return `<tr><td style="padding-bottom:8px;"><table role="presentation" width="100%" style="border:1px solid ${C.line};border-radius:10px;"><tr>
    <td valign="middle" style="padding:12px 8px 12px 14px;font-family:${EPI};font-size:14px;font-weight:700;color:${C.ink};">${esc(a.name)}<div style="font-size:12px;font-weight:400;color:${C.muted};padding-top:2px;">${esc(a.note)}</div></td>
    <td width="72" valign="middle" class="hide-s" style="padding:12px 6px;"><table role="presentation" width="64" style="height:20px;"><tr>${heights.map((h) => bar(h, color)).join('')}</tr></table></td>
    <td width="80" align="right" valign="middle" style="padding:12px 14px 12px 4px;font-family:${MONO};font-size:16px;font-weight:700;color:${color};white-space:nowrap;">${a.score} <span style="font-size:11px;">${arrow}${Math.abs(a.delta)}</span></td>
  </tr></table></td></tr>`
}
function engColumn(bg: string, mono: string, label: string, count: number, body: string, footer: string, footerColor: string): string {
  return `<td class="stk" width="33%" valign="top" style="background:${bg};border-radius:11px;padding:14px;"><div style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:1px;color:${mono};">${label} &middot; ${count}</div><div style="font-family:${EPI};font-size:12.5px;line-height:18px;color:${C.ink};padding-top:8px;">${body}</div>${footer ? `<div style="font-family:${EPI};font-size:11px;color:${footerColor};padding-top:7px;">${footer}</div>` : ''}</td>`
}
// Plafonne l'affichage d'une liste (le compteur reste le total réel).
function capItems(items: string[], max = 5): string {
  const shown = items.slice(0, max).map(esc).join('<br/>')
  const extra = items.length - max
  return extra > 0 ? `${shown}<br/><span style="color:${C.muted};">+${extra} autre${extra > 1 ? 's' : ''}</span>` : (shown || '<span style="color:' + C.muted + ';">—</span>')
}

export function renderDigest(data: DigestData): { subject: string; html: string } {
  const hero = `<div style="font-family:${EPI};font-size:13px;color:${C.soft};padding-bottom:7px;">${esc(data.periodLabel)}</div><div class="h1" style="font-family:${EPI};font-size:30px;line-height:37px;font-weight:800;letter-spacing:-.7px;color:${C.ink};">${data.headline}</div>`

  const week = sectionLabel('Ta semaine qui vient')
    + `<table role="presentation" width="100%">${data.weekAhead.map(meetingRow).join('')}</table>`
    + `<div style="font-family:${EPI};font-size:12px;color:${C.muted};padding-top:3px;">${esc(data.weekAheadNote)}</div>`

  const nps = rule() + `<table role="presentation" width="100%"><tr><td valign="top" style="font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:1.4px;color:${C.muted};">NPS PORTEFEUILLE</td><td align="right" valign="top" style="font-family:${MONO};font-size:26px;font-weight:700;color:${C.ink};line-height:24px;">${data.nps.value} <span style="font-size:13px;color:${data.nps.delta >= 0 ? C.green : C.red};">${data.nps.delta >= 0 ? '&#9650;+' : '&#9660;&minus;'}${Math.abs(data.nps.delta)}</span></td></tr></table><div style="font-family:${EPI};font-size:12px;color:${C.muted};padding-top:10px;">${data.nps.weeks} semaines &middot; ${data.nps.accounts} comptes suivis</div>`

  const accounts = rule() + sectionLabel('Les comptes suivis, cette semaine')
    + `<table role="presentation" width="100%"><tr><td style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:1px;color:${C.green};padding:0 0 8px 0;">&#9650; SE R&Eacute;CHAUFFENT</td></tr>${data.warming.map((a) => accountRow(a, true)).join('')}`
    + (data.declining.length ? `<tr><td style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:1px;color:${C.red};padding:12px 0 8px 0;">&#9660; D&Eacute;CROCHE</td></tr>${data.declining.map((a) => accountRow(a, false)).join('')}` : '')
    + `</table>`

  const eng = data.engagements
  const engagements = rule() + sectionLabel(`Vos engagements &middot; ${eng.openTotal} ouverts`)
    + `<table role="presentation" width="100%"><tr>`
    + engColumn('#FDEFF1', C.red, '&#9888; GLISS&Eacute;S', eng.slipped.length, (eng.slipped.slice(0, 5).map((s) => `<strong>${esc(s.account)}</strong> &middot; ${esc(s.label)}<br/><span style="color:${C.red};font-size:11px;">${esc(s.since)}</span>`).join('<br/>') || `<span style="color:${C.muted};">—</span>`) + (eng.slipped.length > 5 ? `<br/><span style="color:${C.muted};">+${eng.slipped.length - 5} autre${eng.slipped.length - 5 > 1 ? 's' : ''}</span>` : ''), '', C.red)
    + `<td width="8" class="hide-s">&nbsp;</td>`
    + engColumn('#FDF6EC', C.amber, '&#8635; EN COURS', eng.inProgress.length, capItems(eng.inProgress), esc(eng.inProgressNote), C.amber)
    + `<td width="8" class="hide-s">&nbsp;</td>`
    + engColumn('#EDF8F2', C.green, '&#10003; VALID&Eacute;S', eng.validated.length, capItems(eng.validated), '', C.green)
    + `</tr></table>`

  const highlights = sectionLabel('Les temps forts de la semaine')
    + `<table role="presentation" width="100%">${data.highlights.map((h) => `<tr><td valign="top" width="18" style="padding:0 0 9px 0;font-family:${EPI};font-size:12px;color:${h.kind === 'ok' ? C.green : C.red};">${h.kind === 'ok' ? '&#10003;' : '&#9888;'}</td><td valign="top" style="padding:0 0 9px 0;font-family:${EPI};font-size:13.5px;line-height:20px;color:${C.ink};">${h.text} <span style="color:${C.faint};font-size:11.5px;white-space:nowrap;">${esc(h.when)}</span></td></tr>`).join('')}</table>`

  const watch = data.watch.length
    ? sectionLabel('Ce qui bouge dehors &middot; veille')
      + `<table role="presentation" width="100%">${data.watch.map((w) => `<tr><td style="padding-bottom:12px;"><span style="display:inline-block;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;${WATCH_COLOR[w.tagColor]}padding:4px 8px;border-radius:6px;">${esc(w.tag)}</span><div style="font-family:${EPI};font-size:13.5px;line-height:20px;color:${C.ink};padding-top:6px;">${w.text} <span style="color:${C.faint};font-size:11.5px;">${esc(w.source)}</span></div></td></tr>`).join('')}</table>`
      + `<div style="font-family:${EPI};font-size:11.5px;line-height:17px;color:${C.muted};">${esc(data.watchNote)}</div>`
    : ''

  const inner = row(hero, { top: 34, bottom: 6 })
    + row(week, { top: 26 })
    + row(nps, { top: 26 })
    + row(accounts, { top: 26 })
    + row(engagements, { top: 26 })
    + row(highlights, { top: 26 })
    + row(watch, { top: 24, bottom: 6 })

  return {
    subject: data.subject,
    html: emailShell({
      subject: data.subject, preheader: data.preheader, headerRight: 'Le point · lundi 8 h',
      cta: { label: 'Ouvrir mon tableau de bord', url: data.dashboardUrl },
      footerNote: data.computedNote,
    }, inner),
  }
}

export function renderDigestEmpty(data: DigestData): { subject: string; html: string } {
  const week = sectionLabel('Ta semaine qui vient')
    + `<table role="presentation" width="100%">${data.weekAhead.map(meetingRow).join('')}</table>`
    + `<div style="font-family:${EPI};font-size:13.5px;line-height:21px;color:${C.ink};padding-top:16px;">Aucun mouvement ne justifie ton attention cette semaine. On te le dit plut&ocirc;t que d&rsquo;inventer.</div>`
  const hero = `<div style="font-family:${EPI};font-size:13px;color:${C.soft};padding-bottom:7px;">${esc(data.periodLabel)}</div><div class="h1" style="font-family:${EPI};font-size:30px;line-height:37px;font-weight:800;letter-spacing:-.7px;color:${C.ink};">${data.headline}</div>`
  const inner = row(hero, { top: 34, bottom: 6 }) + row(week, { top: 26, bottom: 6 })
  return {
    subject: data.subject,
    html: emailShell({
      subject: data.subject, preheader: data.preheader, headerRight: 'Le point · lundi 8 h',
      cta: { label: 'Ouvrir mon tableau de bord', url: data.dashboardUrl },
      footerNote: data.computedNote,
    }, inner),
  }
}

// Données d'exemple (mode test) — reflètent la maquette d'origine.
export const SAMPLE_DIGEST: DigestData = {
  subject: 'Ta semaine · 4 réunions, 3 engagements en retard',
  preheader: 'Adivisa 30 j, Belcourt 22 j, Montclar 15 j. Et Montclar décroche de 11 points.',
  periodLabel: 'Semaine du 27 juillet au 2 août',
  headline: 'Trois comptes se r&eacute;chauffent.<br/>Un d&eacute;croche.',
  dashboardUrl: 'https://tohu.co/app/home',
  weekAhead: [
    { day: 'MAR', time: '9 h', who: 'Erwan Lefèvre + 1', sub: 'Cadrage déploiement · Adivisa Techno', badge: 'antisèche prête', badgeKind: 'ready' },
    { day: 'MER', time: '14 h', who: 'Camille Ferrand', sub: 'Comité trimestriel · Vertane Groupe', badge: 'antisèche prête', badgeKind: 'ready' },
    { day: 'JEU', time: '11 h', who: 'Nora Bellec', sub: 'Découverte · Sarona Group', badge: 'premier contact', badgeKind: 'first' },
    { day: 'VEN', time: '16 h', who: 'Interne', sub: 'Réunion d’équipe', badge: 'hors périmètre', badgeKind: 'out' },
  ],
  weekAheadNote: 'Deux antisèches arriveront la veille à 18 h, sans rien demander.',
  nps: { value: 58, delta: 4, weeks: 12, accounts: 5 },
  warming: [
    { name: 'Vertane Groupe', note: 'Le DAF est entré dans la boucle · 3 échanges', score: 72, delta: 14 },
    { name: 'Belcourt Syndic', note: 'Réponses plus rapides · 2 j → 6 h', score: 64, delta: 8 },
    { name: 'Sérénia', note: 'Première réunion à 3 côté client', score: 55, delta: 6 },
  ],
  declining: [
    { name: 'Montclar Immobilier', note: '31 j sans échange · 2 relances sans réponse', score: 38, delta: 11 },
  ],
  engagements: {
    slipped: [
      { account: 'Adivisa', label: 'point DAF', since: 'promis le 3 juil. · 30 j' },
      { account: 'Belcourt', label: 'chiffrage 3 ans', since: 'promis le 11 juil. · 22 j' },
      { account: 'Montclar', label: 'retour sécurité', since: 'promis le 18 juil. · 15 j' },
    ], slippedDelta: 1,
    inProgress: ['Planning de déploiement', 'Accès environnement test', 'Relecture juridique'], inProgressNote: '3 côté client',
    validated: ['Grille tarifaire 3 ans', 'Compte-rendu du comité', 'Deux références client'], validatedDelta: 3,
    openTotal: 16,
  },
  highlights: [
    { kind: 'ok', text: '<strong>Vertane</strong> &mdash; le DAF a rejoint la boucle après six mois d’absence.', when: 'mercredi' },
    { kind: 'ok', text: '<strong>Sérénia</strong> &mdash; première réunion à trois côté client, la couverture passe de 1 à 3.', when: 'jeudi' },
    { kind: 'warn', text: '<strong>Adivisa</strong> &mdash; le point avec la DAF franchit 30 j de retard.', when: 'seuil atteint vendredi' },
  ],
  watch: [
    { tag: 'Mobilité', tagColor: 'red', text: '<strong>Erwan Lefèvre</strong> quitte Adivisa Techno pour Sarona Group, DG, effet septembre.', source: 'LinkedIn + RCS · 2 sources' },
    { tag: 'Croissance', tagColor: 'green', text: '<strong>Vertane Groupe</strong> lève 4,2 M€ et ouvre deux postes en RevOps.', source: 'Pappers + presse · 2 sources' },
    { tag: 'Marché', tagColor: 'blue', text: 'Le principal concurrent de <strong>Belcourt Syndic</strong> a été racheté jeudi.', source: 'Presse sectorielle' },
  ],
  watchNote: '9 mouvements captés, 3 retenus — ceux qui touchent un compte où tu as une relation active.',
  cadenceNote: 'Chaque lundi à 8 h. Douze semaines d’historique déjà accumulées.',
  computedNote: 'Calculé ce lundi à 6 h · fenêtre 12 semaines · sources : Outlook, Google Calendar, Read AI, Pappers, presse',
}
