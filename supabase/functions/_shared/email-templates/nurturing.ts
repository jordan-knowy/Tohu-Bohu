// Rendu de la séquence nurturing (ACT-89, J+0/3/7/14/21) sur le layout partagé.
// Une seule mission par mail, une réassurance, un CTA. onb_5 (J+21) = renvoi de onb_4.
import { EPI, C, esc, row, emailShell } from './layout.ts'

export type NurtureStep = 1 | 2 | 3 | 4 | 5
export type NurtureData = { firstName?: string; contacts?: number; companies?: number }

const APP = 'https://tohu.co/app'

function para(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${EPI};font-size:15px;line-height:24px;color:${C.ink};">${text}</p>`
}
function reassure(text: string): string {
  return `<div style="margin-top:6px;font-family:${EPI};font-size:12.5px;line-height:19px;color:${C.muted};border-left:3px solid ${C.lavLine};padding-left:12px;">${esc(text)}</div>`
}

type StepDef = { headerRight: string; subject: string; preheader: string; title: string; build: (d: NurtureData) => string; cta: { label: string; url: string } }

function steps(d: NurtureData): Record<NurtureStep, StepDef> {
  const name = d.firstName ? esc(d.firstName) : 'toi'
  return {
    1: {
      headerRight: 'Bienvenue', subject: 'Bienvenue — une seule chose à faire',
      preheader: '90 secondes pour connecter ta boîte. Lecture seule, aucun message envoyé en ton nom.',
      title: 'Une seule chose à faire',
      build: () => para(`Bonjour ${name},`) + para('Tohu construit la mémoire relationnelle de ton équipe à partir de tes échanges. Pour démarrer, <strong>une seule action</strong> : connecter ta boîte mail. 90 secondes.')
        + reassure('Lecture seule. Aucun message n’est envoyé en ton nom, les corps d’emails ne sont pas stockés.'),
      cta: { label: 'Connecter ma boîte', url: `${APP}/connectors` },
    },
    2: {
      headerRight: 'Première valeur', subject: 'Ta première antisèche arrive bientôt',
      preheader: `Tohu a déjà retrouvé ${d.contacts ?? 'tes'} contacts et ${d.companies ?? 'tes'} comptes.`,
      title: 'Tohu a déjà commencé',
      build: () => para(`En quelques minutes, Tohu a retrouvé <strong>${d.contacts ?? 'plusieurs'} contact(s)</strong> et <strong>${d.companies ?? 'plusieurs'} compte(s)</strong> dans tes échanges, avec leur historique.`)
        + para('À partir de là, avant chacune de tes prochaines réunions, <strong>une antisèche arrive toute seule</strong> : engagements sur la table, profil de ton interlocuteur, contexte de l’entreprise.')
        + reassure('Rien à préparer. La prépa te parvient la veille à 18 h.'),
      cta: { label: 'Voir mon portefeuille', url: `${APP}/home` },
    },
    3: {
      headerRight: 'Couverture', subject: 'Tohu ne voit qu’une partie de tes échanges',
      preheader: 'Des champs affichent « à confirmer ». Ce n’est pas un bug, c’est la règle.',
      title: 'Tu peux voir plus net',
      build: () => para(`${name.charAt(0).toUpperCase() + name.slice(1)}, certaines fiches affichent encore <strong>« à confirmer »</strong>. Ce n’est pas un bug : Tohu n’affirme que ce qu’il observe.`)
        + para('Chaque source que tu ajoutes (agenda, Meet, Read AI, LinkedIn…) comble ces angles morts et rend les profils plus fiables.')
        + reassure('Honnêteté avant tout : Tohu ne remplit jamais un blanc par une supposition.'),
      cta: { label: 'Ajouter une source', url: `${APP}/connectors` },
    },
    4: {
      headerRight: 'Équipe', subject: 'La relation appartient à l’entreprise, pas à une boîte mail',
      preheader: 'Seul, tu as une mémoire. À plusieurs, celle de l’entreprise. Aucun score individuel visible.',
      title: 'Passe à la mémoire d’équipe',
      build: () => para('Seul, tu as ta mémoire relationnelle. À plusieurs, tu as <strong>celle de l’entreprise</strong> : quand un collègue parle à un de tes comptes, la relation ne repart pas de zéro.')
        + para('Invite ton équipe pour mutualiser la couverture des comptes.')
        + reassure('Aucun manager ne voit de score individuel. Personne n’est noté.'),
      cta: { label: 'Inviter mon équipe', url: `${APP}/team` },
    },
    5: {
      headerRight: 'Équipe', subject: 'Rappel — la mémoire d’équipe t’attend',
      preheader: 'Un collègue qui parle à ton compte, et la relation ne repart pas de zéro.',
      title: 'Passe à la mémoire d’équipe',
      build: () => para('Petit rappel : tant que tu es seul sur Tohu, la couverture de tes comptes dépend de toi seul.')
        + para('En invitant ton équipe, chaque échange d’un collègue avec un de tes comptes <strong>enrichit la relation commune</strong>.')
        + reassure('Toujours aucun score individuel visible. La mémoire est partagée, pas la notation.'),
      cta: { label: 'Inviter mon équipe', url: `${APP}/team` },
    },
  }
}

export function renderNurturing(step: NurtureStep, data: NurtureData = {}): { subject: string; html: string } {
  const s = steps(data)[step]
  const hero = `<div class="h1" style="font-family:${EPI};font-size:30px;line-height:37px;font-weight:800;letter-spacing:-.7px;color:${C.ink};">${esc(s.title)}</div>`
  const inner = row(hero, { top: 34, bottom: 8 }) + row(s.build(data), { top: 6, bottom: 8 })
  return {
    subject: s.subject,
    html: emailShell({ subject: s.subject, preheader: s.preheader, headerRight: s.headerRight, cta: s.cta }, inner),
  }
}
