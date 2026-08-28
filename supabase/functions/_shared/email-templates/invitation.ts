// Rendu de l'invitation d'équipe sur le layout partagé — même DA que
// alerte/antisèche/digest (gradient violet→rose, Epilogue/JetBrains Mono).
import { EPI, C, esc, rule, row, emailShell } from './layout.ts'

export type TeamInviteData = {
  inviterName: string
  organizationName: string
  role: 'admin' | 'member'
  inviteUrl: string
}

export function renderTeamInvite(data: TeamInviteData): { subject: string; html: string } {
  const subject = `${data.inviterName} t’invite à rejoindre ${data.organizationName} sur Tohu`
  const roleLabel = data.role === 'admin' ? 'administrateur' : 'membre'

  const hero = `<div class="h1" style="font-family:${EPI};font-size:27px;line-height:34px;font-weight:800;letter-spacing:-.6px;color:${C.ink};padding-bottom:10px;">Rejoins ${esc(data.organizationName)} sur Tohu</div><div style="font-family:${EPI};font-size:14.5px;line-height:23px;color:${C.soft};"><strong>${esc(data.inviterName)}</strong> t’invite à rejoindre son espace de travail, en tant que ${roleLabel}.</div>`

  const note = rule()
    + `<table role="presentation" width="100%" style="background:${C.lav};border-radius:11px;"><tr><td style="padding:16px 18px;font-family:${EPI};font-size:13.5px;line-height:21px;color:${C.ink};">Tohu centralise la mémoire relationnelle de l’équipe — comptes, contacts, échanges et signaux — pour que personne ne reparte de zéro sur une relation.</td></tr></table>`

  const inner = row(hero, { top: 34, bottom: 6 }) + row(note, { top: 24, bottom: 8 })

  return {
    subject,
    html: emailShell({
      subject,
      preheader: `${data.inviterName} t’invite à rejoindre ${data.organizationName} sur Tohu.`,
      headerRight: 'Invitation · équipe',
      cta: { label: 'Rejoindre l’équipe', url: data.inviteUrl },
      footerNote: 'Invitation envoyée depuis Tohu · lien valable 7 jours.',
    }, inner),
  }
}
