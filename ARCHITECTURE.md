# Architecture

Application Vite + TypeScript multi-pages, connectée au projet Supabase
`bgmtzwfafcgjklgygvtx`. Depuis la refonte de juillet 2026, **toute l'app
authentifiée vit dans un seul shell React** (`app.html` → `src/shell/`) :
la navigation entre les pages est du routing client (React Router), sans
rechargement navigateur.

## Routes publiques et points d'entrée

Les visiteurs utilisent uniquement les slugs propres. Les fichiers `.html`
restent des entrées internes nécessaires au build Vite et ne sont jamais
présentés comme URLs produit.

| Route visible | Entrée interne | Rôle |
|---|---|---|
| `/` | `index.html` | Landing publique (`src/pages/landing.ts`) |
| `/connexion` | `login.html` | Connexion SSO |
| `/bienvenue` | `onboarding.html` | Onboarding protégé |
| `/app/*` | `app.html` | **Shell React unifié** |
| — | `tohu-app.html` | Compatibilité avec les anciens liens uniquement |
| — | `home-preview.html` | Harnais dev, absent de la production |

## Arborescence `src/`

```
src/
├── shell/            Coquille de l'app authentifiée : AppShell (sidebar,
│   │                 topbar, recherche globale), table des routes, boot.
│   ├── main.tsx
│   ├── GlobalSearch.tsx
│   └── pages/        Vues portées de l'ancien shell vanilla, une par route :
│                     AskPage, HomePage, ConnectorsPage, ProfilePage,
│                     AccountSettingsPage.
├── home/             Cockpit Home. `render.ts` est un moteur autonome
│   │                 (markup + événements liés dans son container), hébergé
│   │                 par shell/pages/HomePage.tsx.
│   ├── render.ts     Rendu + interactions (ex-home.ts)
│   ├── service.ts    Accès données (requêtes parallèles, RLS)
│   ├── types.ts      Types partagés du cockpit
│   ├── priority.ts   Règles de priorité/risque (testées)
│   └── preview.ts    Entrée du harnais home-preview.html
├── account-list/     Liste Comptes (page + service + mapping, testés)
├── account-detail/   Fiche Compte (page + service + types)
├── person-list/      Liste Personnes (page + service + mapping)
├── person-detail/    Fiche Personne (page + sections + service + ui
│                     partagée : ToastProvider/useToast/useBusy)
├── services/         Accès données transverses (plusieurs features) :
│   ├── data.ts       Organisation, listes, création, connecteurs, profils,
│   │                 recherche globale, feedback signaux
│   ├── signal-labels.ts      Libellés FR des types de signaux (testé)
│   └── strategic-reading.ts  Mapper + règle de suffisance de la lecture
│                             stratégique (testé ; consommé par l'Edge
│                             Function account-strategic-reading côté écran
│                             à rebrancher)
├── pages/            Scripts d'entrée des pages hors shell (landing, login,
│                     onboarding, legacy-redirect)
├── lib/              Fondations : auth.ts (session), supabase.ts (client)
├── components/       logo.ts (logo inline partagé)
└── styles/           CSS partagé — importé par le shell : app.css (shell +
                      vues portées), home.css (cockpit), account-list.css
                      (contient le ticker .crm-mvt réutilisé par Home/
                      Comptes/Personnes), account-detail.css (.ra-*),
                      person-detail.css (.pp), person-list.css ;
                      public.css est réservé à landing/login/onboarding.
```

## Conventions

- **Un dossier par feature**, fichiers non préfixés : `service.ts`,
  `types.ts`, `mapping.ts`, page en `PascalCase.tsx`, tests dans
  `__tests__/` à côté du code testé.
- **Aucune donnée simulée** : ce qui n'existe pas en base est affiché
  « Données insuffisantes » ou masqué (règle produit, voir README).
- **Toasts** : `ToastProvider`/`useToast` de `person-detail/ui.tsx` sont la
  primitive commune ; chaque page qui en a besoin s'enveloppe dans le
  provider (au niveau route dans `shell/main.tsx`).
- **Navigation** : jamais de `window.location` interne — `Link`/`useNavigate`.
  Seules exceptions : les départs OAuth (redirection vers un domaine externe)
  et le redirecteur legacy.
- **CSS** : classes préfixées par feature (`.ra-*` fiche compte, `.pp` fiche
  personne, `.crm-mvt` ticker) ; les éléments portalés vers `document.body`
  (menus, drawers) ne doivent **pas** être stylés sous un préfixe de page.

## Routage

Netlify (`netlify.toml`) et le middleware dev (`vite.config.ts`) appliquent
les mêmes réécritures internes : `/connexion`, `/bienvenue`, `/app` et
`/app/*`. Le navigateur conserve toujours le slug propre.

## Backend

Edge Functions dans `supabase/functions/` (une par intégration :
`connect-email-provider`, `connect-hubspot`, `connect-salesforce`,
`sync-email-analysis`, `ask-tohu-proxy`, `account-strategic-reading`).
Schéma, migrations et règles produit : voir README.md.
