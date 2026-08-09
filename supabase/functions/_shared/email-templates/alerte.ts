// Rendu de l'alerte (signal fort en temps réel) sur le layout partagé.
import { EPI, MONO, C, esc, sectionLabel, rule, row, emailShell } from './layout.ts'

export type AlerteData = {
  subject: string; preheader: string
  tag: { text: string; color: 'red' | 'green' | 'blue' }
  title: string           // l'événement (titre du signal)
  who: string             // "Adivisa Techno · Erwan Lefèvre"
  proof: string[]         // "La preuve" : éléments/sources
  source: string          // "LinkedIn + presse · 2 sources"
  impact: string          // "Ce que ça change chez toi"
  cta?: { label: string; url: string }
  computedNote: string
}

const TAG: Record<'red' | 'green' | 'blue', string> = {
  red: `color:${C.red};background:#FDEFF1;`, green: `color:${C.green};background:#EDF8F2;`, blue: `color:${C.teal};background:#EAF6F8;`,
}

export function renderAlerte(data: AlerteData): { subject: string; html: string } {
  const hero = `<div style="padding-bottom:10px;"><span style="display:inline-block;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;${TAG[data.tag.color]}padding:4px 9px;border-radius:6px;">${esc(data.tag.text)}</span></div><div class="h1" style="font-family:${EPI};font-size:29px;line-height:36px;font-weight:800;letter-spacing:-.7px;color:${C.ink};padding-bottom:8px;">${esc(data.title)}</div><div style="font-family:${EPI};font-size:14.5px;line-height:22px;color:${C.soft};">${esc(data.who)}</div>`

  const proof = rule() + sectionLabel('La preuve')
    + `<table role="presentation" width="100%" style="border:1px solid ${C.line};border-radius:11px;"><tr><td style="padding:15px 18px;"><table role="presentation" width="100%">${data.proof.map((p) => `<tr><td valign="top" width="18" style="padding:0 0 8px 0;color:${C.teal};font-family:${EPI};font-size:13px;">&#9679;</td><td valign="top" style="padding:0 0 8px 0;font-family:${EPI};font-size:14px;line-height:21px;color:${C.ink};">${p}</td></tr>`).join('')}</table><div style="font-family:${EPI};font-size:11.5px;color:${C.faint};padding-top:6px;">${esc(data.source)}</div></td></tr></table>`

  const impact = rule() + sectionLabel('Ce que ça change chez toi')
    + `<table role="presentation" width="100%" style="background:${C.lav};border-radius:11px;"><tr><td style="padding:16px 18px;font-family:${EPI};font-size:14.5px;line-height:23px;color:${C.ink};">${data.impact}</td></tr></table>`

  const inner = row(hero, { top: 34, bottom: 6 }) + row(proof, { top: 24 }) + row(impact, { top: 24, bottom: 26 })

  return {
    subject: data.subject,
    html: emailShell({ subject: data.subject, preheader: data.preheader, headerRight: 'Alerte · veille', cta: data.cta, footerNote: data.computedNote }, inner),
  }
}
