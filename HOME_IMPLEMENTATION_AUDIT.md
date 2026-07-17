# HOME_IMPLEMENTATION_AUDIT

Audit réalisé le 15 juillet 2026, avant toute modification, conformément à la mission « Construire la Home fonctionnelle de Tohu ».

> Mise à jour d'exécution du 16 juillet 2026 : le MCP Supabase `TB` a été
> réauthentifié et le schéma distant `bgmtzwfafcgjklgygvtx` a pu être
> contrôlé directement. Les constats distants et le statut d'application des
> migrations ci-dessous remplacent les hypothèses initiales de l'audit.

---

## ⚠️ Deux écarts majeurs entre la mission et la réalité du projet

### 1. Le projet n'est pas en React

La mission demande une « page React » et cite React Router comme partie de « l'architecture actuelle ». **C'est inexact** : le projet est une application **Vite + TypeScript vanilla multi-pages** :

- `package.json` ne contient ni `react`, ni `react-dom`, ni `react-router` — la seule dépendance est `@supabase/supabase-js` ;
- l'app est orchestrée par [src/app/main.ts](src/app/main.ts) (630 lignes) : vues HTML dans `tohu-app.html`, rendu par `innerHTML`, navigation par `go(view)` + `?view=` dans l'URL ;
- la couche données typée existe déjà : [src/app/data.ts](src/app/data.ts) (types `Account`, `Person`, `Signal`, services Supabase).

**Décision retenue** : la mission impose aussi « Respecte l'architecture actuelle du projet » et « Ne commence pas une refonte générale du projet ». Introduire React uniquement pour la Home créerait précisément la « deuxième application » que la mission interdit. La Home est donc implémentée **dans l'architecture existante** (module TypeScript typé + service de données + CSS du design system), avec la même rigueur que demandée (contrat de données, états, zéro donnée en dur). Une migration React globale reste possible plus tard ; c'est une décision produit séparée.

### 2. Accès au projet Supabase confirmé

Le MCP `TB` cible bien `bgmtzwfafcgjklgygvtx`. L'introspection distante a
confirmé les tables et contraintes utilisées par la Home. Au moment du contrôle,
la base contenait 8 organisations, 12 comptes, 43 contacts, 4 connecteurs,
104 signaux entreprise et 182 signaux comportementaux. Les objets Home
(`home_action_states`, `insight_feedback`, colonnes de suivi et progression)
n'existaient pas encore : ils ne faisaient donc pas doublon avec une structure
historique.

Le statut distant est suivi dans le rapport final. Le mode dégradé reste dans
le client comme garde-fou de déploiement, mais n'est pas le mode nominal.

---

## 1. Composants existants

| Élément | Localisation | Rôle |
|---|---|---|
| Vue Home actuelle | `tohu-app.html` `#view-home` → `#home-content`, rendue par `loadHome()` dans [src/app/main.ts:243-263](src/app/main.ts#L243-L263) | Hero + 4 KPI + 2 listes. Ne correspond pas à la maquette cible |
| Maquette de référence | `/Users/jordanchekroun/Desktop/Tohu/tohu-app.html` (1,8 Mo, 88 blocs `<style>`, patchs `home-v5-js`/`home-v6-js`) — le `tohu-app.html` du repo n'est qu'un shell | Vue Home cible : 4 états de synchro `sync-s0`→`sync-s3` + cockpit (`free-banner`, `hdelta`, `hscore`, `hstats`, `htop`, `hcoach2/krs`, `krs-stack`, `sig-card`) |
| Couche données | [src/app/data.ts](src/app/data.ts) | Types + services Supabase existants, mapping `companies`→`Account`, `contacts`→`Person` |
| Design system | [src/styles/tokens.css](src/styles/tokens.css) (variables), [src/styles/app.css](src/styles/app.css) (shell, `.view.active`, `.panel`, `.score`, breakpoints 980/780px) | Source de vérité visuelle. NB : la maquette utilise `.view.show`, l'app `.view.active` |
| Auth/session | [src/lib/auth.ts](src/lib/auth.ts), [src/lib/supabase.ts](src/lib/supabase.ts) | `requireSession()`, SSO Google/Azure/LinkedIn |
| Edge Functions | `connect-email-provider` (jetons Vault), `sync-email-analysis` (ingestion Gmail/Outlook + analyses IA + `sync_jobs`), `ask-tohu-proxy` (RLS via JWT utilisateur) | Pipeline réel déjà en place |

Les documents `08_scoring_relationnel.md`, `09_pipeline_signal_extraction.md`, `10_scoring_brief_integration.md` cités par la mission **n'existent nulle part sur la machine** (recherche Spotlight + parcours disque). Le moteur de scoring décrit (`engagement_score`, `phase_delta`, `reciprocity_score`, `relationship_depth`, `active_alerts`…) n'est pas implémenté. Les colonnes réellement disponibles sont `relationship_snapshots.engagement_score/phase/snapshot_date/last_contact_at` (par contact) et `companies.public_context.relationship_score` (JSON). La Home consommera **uniquement ces valeurs persistées** ; ce qui n'existe pas est affiché « Données insuffisantes ».

## 2. Données actuellement simulées (dans la maquette de référence)

À ne **pas** reprendre :

- tableau `ACCTS` (8 comptes fictifs : Norévia, Adivisa…) et cap `CAP=5` codé en dur ;
- steppers S1/S3 sur `setTimeout(770ms)` sans job réel ;
- « Outlook connecté · maxime@tohu.co » statique ;
- score global `58`, « +6 sur 6 mois », « Moyenne secteur ~52 » inventés ;
- Top 5 statique pointant vers `knowr-compte-csjc.html` via `openFiche()` (iframe) ;
- compteurs `8 comptes / 6 contacts / ±30j` inventés ;
- coaching « Niveau 3 · Référent · 68% → Stratège » sans règle ;
- « synchro il y a 2 min » statique ;
- 8 signaux fictifs (CSJC, Adivisa, Belcourt…) ;
- boutons `toast('… (démo)')` : simulation, feedback, veille complète, Fait/Écarter.

Dans l'app actuelle, `loadHome()` est déjà branché sur Supabase mais : moyenne trompeuse (mixe comptes+personnes, ignore les null partiellement), pas de digest, pas de forfait, pas d'actions, pas de coaching, pas d'expérience de première synchronisation.

## 3. Fonctions actuellement simulées

Dans la maquette uniquement (le repo n'a pas de fonctions simulées sur la Home) : `syncStart`, `analyzeSel`, `syncReveal`, `selToggle`, `homeKrsDone`, `cptTog`, `topTog`, `openFiche`, feedback coaching. Toutes remplacées par des implémentations réelles ou des états « non disponible » honnêtes.

## 4. Tables Supabase réutilisées (preuves : migrations locales + Edge Functions + requêtes front)

| Table | Colonnes attestées | Usage Home |
|---|---|---|
| `profiles` | id, full_name, avatar_url, role_title, company_name, website_url, product_summary, onboarding_completed | identité, `last_home_seen_at` (à ajouter) |
| `organizations`, `memberships` | organization_id, user_id | workspace actif, RLS `private.is_org_member()` |
| `companies` | id, organization_id, name, domain, industry, account_type, account_type_confidence, public_context (jsonb : status, location, relationship_score, confidence_score, last_interaction_at, notes), last_monitored_at, created_at, updated_at | comptes, scores, Top 5, suivi (colonnes à ajouter) |
| `contacts` | id, organization_id, company_id, owner_user_id, full_name, email, role_title, avatar_url, location, web_bio, enrichment_data, source_summary, merged_into_contact_id | personnes, détection d'organisations par domaine |
| `relationship_snapshots` | contact_id (FK imbriquée), engagement_score, phase, snapshot_date, last_contact_at | scores personnes, déclin |
| `cognitive_profiles` | organization_id, contact_id, profile_version, global_confidence, summary, executive_summary, engagement_score, cognitive_mode, behavioral_analysis_data, updated_from, updated_at | profondeur relationnelle |
| `company_signals` | id, company_id, family, title, summary, source, confidence, observed_at, created_at | signaux veille |
| `behavioral_signals` | id, organization_id, contact_id, profile_id, signal_type, text, inference, inference_level, confidence, source_type, source_ref, observed_at | signaux comportementaux |
| `meetings`, `meeting_participants` | company_id, title, starts_at, meeting_type, platform ; contact_id | source Calendrier |
| `connectors` | id, organization_id, user_id, provider, status, scopes, metadata (account_email, last_sync…), last_synced_at | bloc sources, état S0 |
| `oauth_accounts` | connector_id, jetons chiffrés Vault — **service_role uniquement** (migrations 0005-0008) | jamais exposé à la Home |
| `sync_jobs` | id, organization_id, connector_id, job_type, status, started_at, completed_at, payload (jsonb), error_message | **réutilisée** pour les jobs S1/S3 (colonnes à compléter) |
| `communication_threads`, `communication_messages` | organization_id, thread_id, contact_id, provider, external_message_id, direction, sent_at, subject, metadata (`body_text` jamais stocké) | comptage d'interactions pour la détection |
| `subscriptions` | organization_id, plan_id, status | forfait |
| `subscription_plans` | id, name, max_licenses, max_profiles_per_month, features, entitlements | limites du forfait ; `max_tracked_accounts` est initialisé depuis le quota existant (Free 5, Pro 20, Business 50, offres à quota négatif = illimitées) |
| `signal_feedback` | DDL complète (migration 0003) : organization_id, signal_id, user_id, verdict confirmed/dismissed, unique(user_id, signal_id) | confirmer/infirmer un signal |
| `notification_preferences` | user_id, organization_id, email_enabled… | non utilisée par la Home |
| `user_behavioral_profiles` | DDL complète (migration 0005) : select réservé à l'intéressé | bloc coaching |

Fonctions SQL attestées : `private.is_org_member(uuid)`, `get_oauth_tokens_server`, `store_oauth_tokens_server`, `generate_user_notifications(uuid,uuid)` (service_role).

## 5. Colonnes / objets manquants

1. `profiles.last_home_seen_at timestamptz` — digest « depuis ta dernière visite » ;
2. `companies.is_tracked boolean`, `companies.tracked_at`, `companies.tracked_by` — sélection S2/S3 et périmètre du cockpit ;
3. `subscription_plans.max_tracked_accounts integer null` (null = illimité) + seed `free = 5` ;
4. `sync_jobs.user_id`, `sync_jobs.provider`, `sync_jobs.current_step`, `sync_jobs.progress`, `sync_jobs.error_code` + RLS lecture pour les membres de l'organisation ;
5. table `home_action_states` (statut completed/dismissed/postponed par action dérivée, avec motif, auteur, signal d'origine) + RLS ;
6. table `insight_feedback` (feedback coaching : user_id, workspace, insight_id, feedback_type, created_at) + RLS ;
7. RPC `detect_account_candidates()` — détection/dédup d'organisations depuis contacts + communication_messages, journalisée dans `sync_jobs` ;
8. RPC `set_tracked_companies(uuid[])` — **validation de la limite du forfait côté serveur** ;
9. RPC `get_home_dashboard()` — agrégat Home en un aller-retour, security invoker (RLS respectées).

## 6. Migrations nécessaires

- `202607150009_home_foundation.sql` : points 1-6 (idempotente, `add column if not exists`, policies drop/create) ;
- `202607150010_home_rpcs.sql` : points 7-9.

État au 16 juillet 2026 : `202607150009_home_foundation.sql` et
`202607150010_home_rpcs.sql` sont appliquées sur `bgmtzwfafcgjklgygvtx`.
`detect_account_candidates` et `set_tracked_companies` sont exposées par
PostgREST aux utilisateurs authentifiés, avec contrôle du workspace côté
serveur. `sync-email-analysis` est déployée en version 4.

## 7. Fichiers modifiés / créés

- créés : `src/app/home.ts` (vue), `src/app/home-service.ts` (service `getHomeDashboard`), `src/app/home-types.ts` (contrat `HomeDashboardData`), `src/app/home-priority.ts` (règles de priorité documentées), `src/styles/home.css` (CSS repris de la maquette, adapté aux tokens), migrations ci-dessus, tests ;
- modifiés : `tohu-app.html` (squelette `#view-home`), `src/app/main.ts` (délégation de `loadHome`, route `?view=home`), `package.json` (vitest en devDependency + scripts test), `README.md` (documentation Home) ;
- non touchés : Edge Functions existantes, autres vues, `data.ts` (réutilisé, pas réécrit).

## 8. Risques identifiés

1. **Déploiement partiel entre front et migrations** → le client affiche un mode dégradé explicite si une migration manque ; aucune donnée de démonstration n'est substituée.
2. **Quota de comptes** → `max_tracked_accounts` reprend la configuration réelle de `max_profiles_per_month`; le contrôle final est effectué dans la RPC serveur, jamais uniquement dans l'interface.
3. **RLS de `sync_jobs`/`communication_messages` inconnues** → la migration (re)pose des policies de lecture org-membre explicites.
4. **Pas de moteur de scoring** (docs 08/09/10 absents) → le « Score relationnel global » est l'agrégat des scores persistés existants, étiqueté comme tel ; pas de benchmark (aucune source ⇒ sous-section masquée) ; coaching sans règles de niveaux ⇒ « Analyse en cours de calibration », conformément à la mission.
5. **E2E impossible ici** (auth SSO uniquement, pas de compte de test) → tests unitaires/logiques via vitest ; parcours E2E documenté pour exécution manuelle.
6. **Repo sans commit initial** — tout est en untracked ; je ne committe pas sans demande explicite.

## 9. Périmètre respecté

Pas de refonte générale : Ask Tohu, Comptes, Personnes, Connecteurs, Profil, Mon compte inchangés (hors branchements strictement nécessaires : navigation vers fiches réelles, route simulation Ask Tohu).
