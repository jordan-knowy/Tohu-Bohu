// Layout e-mail partagé — habillage figé : fond blanc, largeur 680, épuré (pas de
// cadre flottant), masthead dégradé pleine largeur, DA Tohu (Epilogue / JetBrains
// Mono, violet→rose). Tous les templates (digest, antisèche, alerte, nurturing) le
// réutilisent pour rester cohérents.
export const EPI = "'Epilogue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
export const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,'Courier New',monospace"
export const GRAD = 'background-color:#6E50C8;background-image:linear-gradient(135deg,#6E50C8 0%,#E14FA0 100%)'
export const PX = 'padding-left:34px;padding-right:34px;'

export const C = {
  ink: '#1A1040', soft: '#5B5470', muted: '#8B839F', faint: '#9A93AC',
  green: '#2EA86A', red: '#D94F63', amber: '#C97A20', teal: '#2896A8', violet: '#6E50C8',
  line: '#E7E3F2', lav: '#F7F5FD', lavLine: '#E3DCF5',
}

export function esc(value: string): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Intitulé de section : ● TEXTE en mono, gris. */
export function sectionLabel(text: string): string {
  return `<div style="font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.muted};padding-bottom:13px;">&#9679; ${text}</div>`
}

export function rule(): string {
  return `<div style="height:1px;background:${C.line};margin-bottom:20px;font-size:0;line-height:1px;">&nbsp;</div>`
}

/** Ligne de contenu pleine largeur (padding latéral constant, fond blanc). */
export function row(inner: string, opts: { top?: number; bottom?: number } = {}): string {
  const top = opts.top ?? 28
  const bottom = opts.bottom ?? 0
  return `<tr><td class="px" style="background:#FFFFFF;${PX}padding-top:${top}px;padding-bottom:${bottom}px;">${inner}</td></tr>`
}

/** Bouton principal (dégradé). */
export function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="${GRAD};border-radius:12px;"><a href="${esc(url)}" style="display:block;padding:15px 34px;font-family:${EPI};font-size:15px;font-weight:700;color:#FFFFFF;letter-spacing:-.1px;">${label} &rarr;</a></td></tr></table>`
}

export type ShellOptions = {
  subject: string
  preheader: string
  headerRight: string          // ex. "Le point · lundi 8 h" / "Antisèche · dans 2 h"
  cta?: { label: string; url: string }
  footerNote?: string          // ligne "Calculé … · sources : …"
}

/** Enveloppe complète : head + masthead + contenu (inner) + pied de page. */
export function emailShell(options: ShellOptions, inner: string): string {
  const footerCta = options.cta
    ? `<tr><td align="center" class="px" style="background:#FFFFFF;${PX}padding-top:26px;padding-bottom:4px;">${ctaButton(options.cta.label, options.cta.url)}</td></tr>`
    : ''
  const footerNote = options.footerNote
    ? `<tr><td class="px" align="center" style="background:#FFFFFF;${PX}padding-top:14px;padding-bottom:4px;font-family:${EPI};font-size:11.5px;line-height:18px;color:${C.faint};">${esc(options.footerNote)}</td></tr>`
    : ''
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/><title>${esc(options.subject)}</title>
<style>a{text-decoration:none}img{border:0;display:block}@media only screen and (max-width:680px){.wrap{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.stk{display:block!important;width:100%!important;max-width:100%!important}.h1{font-size:25px!important;line-height:32px!important}.hide-s{display:none!important}}</style></head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#FFFFFF;">${esc(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;"><tr><td align="center" style="padding:0;">
<table role="presentation" class="wrap" width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:680px;">
<tr><td style="${GRAD};padding:18px 34px;"><table role="presentation" width="100%"><tr><td align="left" style="font-family:${EPI};font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:-.3px;">tohu<span style="color:#FFD9EE;">.</span></td><td align="right" style="font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#FFFFFF;opacity:.92;">${esc(options.headerRight)}</td></tr></table></td></tr>
${inner}
${footerCta}
${footerNote}
<tr><td class="px" style="background:#FFFFFF;${PX}padding-top:6px;padding-bottom:8px;"><div style="height:1px;background:${C.line};font-size:0;line-height:1px;">&nbsp;</div></td></tr>
<tr><td class="px" align="center" style="background:#FFFFFF;${PX}padding-top:6px;padding-bottom:34px;font-family:${EPI};font-size:11.5px;line-height:18px;color:${C.faint};">Tohu &middot; Optee SAS &middot; donn&eacute;es h&eacute;berg&eacute;es en UE &middot; lecture seule<br/><a href="https://tohu.co/preferences" style="color:${C.violet};">R&eacute;gler la fr&eacute;quence</a> &middot; <a href="https://tohu.co/preferences" style="color:${C.violet};">Se d&eacute;sabonner</a></td></tr>
</table></td></tr></table></body></html>`
}
