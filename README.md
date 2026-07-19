# Tohu

Webapp du « cerveau relationnel » d’une équipe, construite en Vite + TypeScript et connectée au projet Supabase `bgmtzwfafcgjklgygvtx`.

## Démarrage local

```bash
npm install
cp .env.example .env
npm run dev -- --host 127.0.0.1
```

Ouvrir <http://127.0.0.1:5173/>. Utiliser `127.0.0.1` plutôt que `localhost` si une autre app Vite écoute déjà en IPv6.

Variables frontend autorisées :

```dotenv
VITE_SUPABASE_URL=https://bgmtzwfafcgjklgygvtx.supabase.co
VITE_SUPABASE_ANON_KEY=<clé publishable Supabase>
```

La `service_role` et les secrets OAuth ne doivent jamais être placés dans `.env` ni dans `src/`.

## Fonctionnalités

- landing, connexion SSO et onboarding protégé ;
- comptes issus de `companies` et personnes issues de `contacts` ;
- recherche, tri, création et fiches relationnelles ;
- signaux entreprise et comportementaux, réunions et feedback utilisateur ;
- connecteurs Google, Microsoft, LinkedIn, HubSpot et Salesforce ;
- ingestion Gmail/Outlook et analyses comportementales du responsable et des personnes ;
- profil, préférences de notification et abonnement ;
- Ask Bohu via une Edge Function authentifiée.

## Supabase

Le frontend respecte le schéma métier déjà présent :

- identité : `profiles`, `organizations`, `memberships` ;
- CRM relationnel : `companies`, `contacts`, `relationship_snapshots`, `cognitive_profiles`, `user_behavioral_profiles` ;
- activité : `company_signals`, `behavioral_signals`, `meetings`, `meeting_participants` ;
- produit : `connectors`, `notification_preferences`, `subscriptions`, `subscription_plans`.

Les migrations locales ajoutent uniquement les éléments manquants à l’app :

- `profiles.onboarding_completed` ;
- `signal_feedback`, isolée par RLS utilisateur + organisation.
- `user_behavioral_profiles`, réservé au responsable concerné ;
- chiffrement Vault des jetons dans `oauth_accounts` et blocage des jetons en clair dans `connectors`.
- suivi explicite du portefeuille (`companies.is_tracked`) et limite issue du forfait ;
- progression/reprise des synchronisations dans `sync_jobs` ;
- états persistés des actions Home (`home_action_states`) et feedback coaching (`insight_feedback`).

Elles ont été appliquées au projet le 15 juillet 2026 via le MCP Supabase `TB`. La table `app_secrets` est conservée : elle est utilisée par trois tâches cron.

## OAuth

Google, Azure et LinkedIn OIDC sont activés sur ce projet. La callback fournisseur Supabase est :

```text
https://bgmtzwfafcgjklgygvtx.supabase.co/auth/v1/callback
```

Pour le développement, ajouter dans Authentication → URL Configuration :

```text
http://127.0.0.1:5173/**
```

Les fonctions [connect-email-provider](supabase/functions/connect-email-provider/index.ts) et [sync-email-analysis](supabase/functions/sync-email-analysis/index.ts) assurent le pipeline :

1. validation du compte Google ou Microsoft ;
2. chiffrement des jetons avec une clé conservée dans Supabase Vault ;
3. lecture temporaire d’un volume limité d’emails autorisés ;
4. stockage des métadonnées relationnelles sans corps d’email ;
5. profil du responsable depuis ses messages envoyés ;
6. profil des personnes depuis les messages qu’elles ont rédigés.

Une personne doit disposer d’au moins trois messages exploitables pour lancer son analyse. Les sorties IA sont des synthèses prudentes : aucune pathologie ni donnée sensible ne doit être inférée.

## Ask Bohu

La fonction [ask-tohu-proxy](supabase/functions/ask-tohu-proxy/index.ts) lit `companies`, `contacts`, `company_signals` et `behavioral_signals` avec le JWT de l’utilisateur, donc à travers les RLS existantes.

Secrets serveur requis :

```bash
supabase secrets set OPENROUTER_API_KEY=<clé-secrète>
supabase secrets set OPENROUTER_MODEL=openai/gpt-4.1-mini
supabase secrets set SITE_URL=http://127.0.0.1:5173
```

## Home

La Home (`src/home/render.ts`) est le cockpit relationnel quotidien :

- **Expérience A** (aucun compte suivi) : invitation S0 → détection S1 (ingestion réelle + RPC `detect_account_candidates` journalisée dans `sync_jobs`) → sélection S2 (limite du forfait) → activation S3 (RPC `set_tracked_companies`, limite validée côté serveur). Le parcours reprend après un rafraîchissement via `sync_jobs`.
- **Expérience B** : bandeau forfait, digest depuis la dernière visite (`profiles.last_home_seen_at`), score global agrégé des scores persistés, sources, compteurs, Top 5 Meilleurs/À risque, coaching (`user_behavioral_profiles`), actions du jour (états persistés dans `home_action_states`), signaux avec drawer de validation (`signal_feedback`).

Les données passent par le service unique [src/home/service.ts](src/home/service.ts) (requêtes parallèles, RLS). Les règles de priorité/risque sont documentées et testées dans [src/home/priority.ts](src/home/priority.ts).

Migrations Home du projet : `202607150009_home_foundation.sql` puis
`202607150010_home_rpcs.sql`. Le client conserve un mode dégradé explicite
si un environnement n'a pas encore reçu ces migrations (bandeau
d'avertissement, fonctions concernées désactivées, jamais simulées).

Ces deux migrations sont appliquées sur `bgmtzwfafcgjklgygvtx`. La fonction
`sync-email-analysis` associée est déployée en version 4.

## Lecture stratégique (fiche compte)

Le panneau « Lecture stratégique » de la fiche compte affiche une synthèse
relationnelle réelle, générée côté serveur par l'Edge Function
[account-strategic-reading](supabase/functions/account-strategic-reading/index.ts)
(OpenRouter, mêmes secrets qu'Ask Bohu) et persistée dans
`account_strategic_readings` (migration `202607160011`, lecture RLS membre,
écriture service role). Règle de suffisance documentée et testée dans
[src/services/strategic-reading.ts](src/services/strategic-reading.ts) : au moins un
contact lié et 3 éléments d'historique (signaux + réunions + échanges), sinon
« Lecture en construction » — aucune synthèse n'est inventée. Le prompt ne
reçoit que des métadonnées persistées (jamais de corps d'email).

⚠️ À déployer/appliquer sur le projet :
`202607160011_account_strategic_readings.sql` puis
`supabase functions deploy account-strategic-reading`.

Prévisualisation visuelle sans session (dev uniquement, jamais buildée) :
<http://127.0.0.1:5173/home-preview.html?state=cockpit|s0|s2|empty|degraded|error>.

## Vérifications

```bash
npm run check
npm test
npm run build
```
