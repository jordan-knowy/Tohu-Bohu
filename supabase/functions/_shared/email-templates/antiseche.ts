// Rendu de l'antisèche (prépa réunion T−24 h) sur le layout partagé.
import { EPI, MONO, C, esc, sectionLabel, rule, row, emailShell } from './layout.ts'

export type AntEngagement = { icon: 'slipped' | 'inprogress' | 'validated'; title: string; sub: string; badge: string }
export type AntPerson = { name: string; role: string; modeLabel: string; style: string; faire: string; eviter: string; stats: string; context?: string }
export type AntisecheData = {
  subject: string; preheader: string; headerRight: string
  when: string; title: string; who: string
  relationTag?: { text: string; color: 'red' | 'green' | 'violet' }
  engagements: AntEngagement[]; engagementsNote?: string
  people: AntPerson[]
  company: { name: string; sub: string; watch: string }
  opening: { text: string; note: string }
  computedNote: string
}

const ICON: Record<AntEngagement['icon'], { border: string; glyph: string; color: string; badge: string }> = {
  slipped: { border: C.red, glyph: '&#9888;', color: C.red, badge: `color:${C.red};background:#FDEFF1;` },
  inprogress: { border: C.amber, glyph: '&#8635;', color: C.amber, badge: `color:${C.amber};background:#FDF6EC;` },
  validated: { border: C.green, glyph: '&#10003;', color: C.green, badge: `color:${C.green};background:#EDF8F2;` },
}
const TAG: Record<'red' | 'green' | 'violet', string> = {
  red: `color:${C.red};background:#FDEFF1;`, green: `color:${C.green};background:#EDF8F2;`, violet: `color:${C.violet};background:${C.lav};`,
}

function engRow(e: AntEngagement): string {
  const s = ICON[e.icon]
  return `<tr><td style="padding-bottom:9px;"><table role="presentation" width="100%" style="border:1px solid ${C.line};border-left:3px solid ${s.border};border-radius:9px;"><tr><td width="26" valign="top" style="padding:14px 0 14px 15px;font-family:${EPI};font-size:14px;color:${s.color};">${s.glyph}</td><td valign="top" style="padding:14px 12px 14px 4px;font-family:${EPI};font-size:14.5px;line-height:20px;font-weight:600;color:${C.ink};">${esc(e.title)}<div style="font-size:12px;font-weight:400;color:${C.muted};padding-top:3px;">${esc(e.sub)}</div></td><td align="right" valign="top" style="padding:14px 15px 14px 0;white-space:nowrap;"><span style="display:inline-block;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;${s.badge}padding:4px 8px;border-radius:6px;">${esc(e.badge)}</span></td></tr></table></td></tr>`
}
function styleRow(lab: string, labColor: string, text: string): string {
  return `<tr><td width="96" valign="top" style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;color:${labColor};padding:4px 0 11px 0;">${lab}</td><td valign="top" style="font-family:${EPI};font-size:14px;line-height:21px;color:${C.ink};padding:0 0 11px 0;">${text}</td></tr>`
}
function personCard(p: AntPerson): string {
  return `<table role="presentation" width="100%" style="background:${C.lav};border-radius:12px;"><tr><td style="padding:18px 20px;"><table role="presentation" width="100%"><tr><td align="left" valign="top" style="font-family:${EPI};font-size:17px;font-weight:800;color:${C.ink};letter-spacing:-.2px;">${esc(p.name)}<div style="font-size:13px;font-weight:400;color:${C.soft};padding-top:3px;">${esc(p.role)}</div></td><td align="right" valign="top" style="font-family:${MONO};font-size:12.5px;font-weight:700;color:${C.violet};white-space:nowrap;">${esc(p.modeLabel)}</td></tr></table>
    <div style="height:1px;background:${C.lavLine};margin:15px 0;font-size:0;line-height:1px;">&nbsp;</div>
    <table role="presentation" width="100%">
      ${styleRow('STYLE', C.faint, esc(p.style))}
      ${styleRow('&#10003; FAIRE', C.green, esc(p.faire))}
      ${styleRow('&#10007; &Eacute;VITER', C.red, esc(p.eviter))}
    </table>
    <div style="font-family:${EPI};font-size:12px;color:${C.muted};padding-top:12px;">${esc(p.stats)}</div></td></tr></table>`
    + (p.context ? `<div style="font-family:${EPI};font-size:13.5px;line-height:21px;color:${C.ink};border:1px dashed #D8D1E8;border-radius:12px;padding:16px 20px;margin-top:11px;">${p.context}</div>` : '')
}

export function renderAntiseche(data: AntisecheData): { subject: string; html: string } {
  const hero = `<div style="font-family:${EPI};font-size:13px;color:${C.soft};padding-bottom:7px;">${esc(data.when)}</div><div class="h1" style="font-family:${EPI};font-size:30px;line-height:37px;font-weight:800;letter-spacing:-.7px;color:${C.ink};padding-bottom:9px;">${esc(data.title)}</div><div style="font-family:${EPI};font-size:14.5px;line-height:22px;color:${C.soft};">${esc(data.who)}${data.relationTag ? ` <span style="display:inline-block;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;${TAG[data.relationTag.color]}padding:4px 8px;border-radius:6px;">${esc(data.relationTag.text)}</span>` : ''}</div>`

  const engagements = sectionLabel('Les engagements sur la table')
    + `<table role="presentation" width="100%">${data.engagements.map(engRow).join('')}</table>`
    + (data.engagementsNote ? `<div style="font-family:${EPI};font-size:12px;color:${C.muted};padding-top:3px;">${esc(data.engagementsNote)}</div>` : '')

  const people = rule() + sectionLabel('Qui sera en face') + data.people.map((p, i) => (i ? `<div style="height:10px;">&nbsp;</div>` : '') + personCard(p)).join('')

  const company = rule() + sectionLabel('L’entreprise')
    + `<div style="font-family:${EPI};font-size:17px;font-weight:800;color:${C.ink};letter-spacing:-.2px;">${esc(data.company.name)}<div style="font-size:13px;font-weight:400;color:${C.faint};padding-top:3px;">${esc(data.company.sub)}</div></div>`
    + `<table role="presentation" width="100%" style="border:1px solid ${C.line};border-radius:11px;margin-top:15px;"><tr><td style="padding:15px 18px;"><div style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:1.1px;color:${C.muted};padding-bottom:8px;">VEILLE EXTERNE</div><div style="font-family:${EPI};font-size:14px;line-height:22px;color:${C.ink};">${data.company.watch}</div></td></tr></table>`

  const opening = `<table role="presentation" width="100%" style="background:${C.lav};border-radius:11px;"><tr><td style="padding:17px 20px;"><div style="font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:1.1px;color:${C.muted};padding-bottom:8px;">PAR OÙ OUVRIR</div><div style="font-family:${EPI};font-size:14.5px;line-height:23px;color:${C.ink};font-style:italic;">${data.opening.text}</div><div style="font-family:${EPI};font-size:12px;color:${C.muted};padding-top:9px;">${esc(data.opening.note)}</div></td></tr></table>`

  const inner = row(hero, { top: 34, bottom: 6 })
    + row(engagements, { top: 28 })
    + row(people, { top: 28 })
    + row(company, { top: 28 })
    + row(opening, { top: 28, bottom: 26 })

  return {
    subject: data.subject,
    html: emailShell({ subject: data.subject, preheader: data.preheader, headerRight: data.headerRight, footerNote: data.computedNote }, inner),
  }
}
