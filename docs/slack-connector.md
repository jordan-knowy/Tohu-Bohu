# Connecteur Slack

Le connecteur utilise les mêmes Edge Functions applicatives et tables que HubSpot et Google/Microsoft : `connectors`, jetons chiffrés dans `oauth_accounts` via les RPC Vault, `sync_jobs`, `communication_threads`, `communication_messages`, `resolve_contact_identity`, puis `analyze` / `persistContactProfile`. Le rapprochement prend en compte les alias email existants. Les domaines sont rattachés aux comptes déjà présents ; Slack ne crée pas une entreprise à partir d'un domaine inconnu. Les profils et indices de relation alimentent ensuite le calcul des comptes existant (`score-batch`).

Deux tables techniques, accessibles uniquement au serveur, conservent les états OAuth à usage unique et les points de reprise de synchronisation. Aucun jeton n'est stocké dans les métadonnées des connecteurs ni exposé au navigateur. Comme les autres connecteurs applicatifs, un utilisateur peut connecter un espace Slack par organisation Tohu.

## Configuration et déploiement

1. Créer une application Slack avec `supabase/slack-app-manifest.json`.
2. Dans **OAuth & Permissions**, vérifier l'URL HTTPS exacte : `https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/connect-slack`.
3. Dans **Supabase Dashboard → Edge Functions → Secrets**, enregistrer `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` et `APP_URL`. L'analyse utilise les secrets existants `OPENROUTER_API_KEY` et éventuellement `OPENROUTER_ANALYSIS_MODEL`.
4. Appliquer les migrations du projet, dont `20260908160000_slack_sync.sql`. Les migrations Vault existantes et leur clé de chiffrement sont requises.
5. Déployer `connect-slack` et `sync-slack`. Leur configuration `verify_jwt = false` est intentionnelle : le callback OAuth est public ; les actions POST vérifient explicitement le JWT Supabase et l'appartenance à l'organisation dans le handler.
6. Depuis **Connecteurs → Slack**, connecter l'espace, choisir si les canaux publics doivent enrichir les fiches partagées, puis cliquer sur **Synchroniser / reprendre**. Une nouvelle autorisation est nécessaire après l'ajout de scopes.

Les commandes habituelles sont `supabase db push`, `supabase functions deploy connect-slack` et `supabase functions deploy sync-slack`, sur le projet choisi. Le code n'applique pas automatiquement une migration distante. Les identifiants Slack ne doivent être stockés ni dans `.env`, ni dans une table du schéma `public`.

## Autorisations Slack

Le connecteur demande un **jeton utilisateur**, issu de `authed_user.access_token`, avec :

| Données | Scopes utilisateur |
| --- | --- |
| Utilisateurs et rapprochement email | `users:read`, `users:read.email` |
| Canaux publics | `channels:read`, `channels:history` |
| Canaux privés, facultatifs | `groups:read`, `groups:history` |
| Messages directs, facultatifs | `im:read`, `im:history` |
| Messages directs de groupe, facultatifs | `mpim:read`, `mpim:history` |

Les canaux sont découverts avec `users.conversations` pour le titulaire du jeton ; chaque type doit avoir ses scopes de lecture et d'historique effectivement accordés. Le connecteur ne rejoint aucun canal et n'envoie aucun message. Le rafraîchissement des jetons est pris en charge si la rotation est activée dans Slack. La déconnexion supprime les jetons locaux et tente `auth.revoke` ; en cas d'indisponibilité Slack, une révocation manuelle chez Slack reste possible.

## Confidentialité et provenance

- Les messages privés et les canaux publics non partagés ne conservent que les métadonnées et références ; leurs lignes sont réservées à l'utilisateur importateur par une politique RLS restrictive. Ils n'ont ni `contact_id` ni texte brut, ce qui les exclut des agrégations de personnes et comptes partagés. Ils ne sont pas envoyés au modèle d'analyse.
- L'option d'enrichissement des canaux publics est désactivée à chaque connexion. Une fois activée, les auteurs identifiables par email sont rapprochés avec les personnes et comptes existants. Les messages sortants sont rattachés uniquement lorsqu'un destinataire est explicitement mentionné ou identifié comme auteur du fil ; ils ne sont pas analysés comme des propos du contact.
- Le texte public est utilisé temporairement par le pipeline d'analyse existant et n'est pas conservé dans `body_text`. Les profils dérivés sont partagés selon les règles existantes de Tohu. Désactiver l'option arrête les enrichissements suivants ; cela ne retire pas les contributions déjà partagées.
- La provenance comprend espace, canal, horodatage Slack exact, racine du fil, auteur et lien obtenu avec `chat.getPermalink`. Les signaux comportementaux utilisent ce lien comme `source_ref`, affiché avec le libellé Slack dans les fiches.

## Synchronisation et reprise

La première passe parcourt l'historique disponible, dans les limites de rétention et d'accès de Slack. Les passes suivantes utilisent un point de reprise propre à chaque canal et une borne temporelle fixe et parcourent aussi toutes les racines de fils déjà connues pour récupérer les réponses à d'anciens messages. Les utilisateurs et canaux sont redécouverts à chaque passe. Les curseurs et bornes ne sont validés qu'après traitement de la page. Les identifiants externes conservent la précision des timestamps Slack pour dédupliquer messages et fils.

Une invocation lit au plus une page d'historique (15 messages), puis récupère ses références et enrichit les auteurs. Le budget de travail limite le nombre d'analyses par invocation ; les messages déjà analysés portent un marqueur de reprise. Un verrou temporaire empêche les synchronisations concurrentes d'un même connecteur. Les erreurs de stockage ou d'analyse conservent la page courante pour une reprise.

L'interface enchaîne les invocations et respecte `Retry-After`. Fermer la page interrompt cet enchaînement ; **Synchroniser / reprendre** reprend depuis l'état serveur. Il n'y a pas de cron Slack ni d'abonnement Events API dans cette version. Les éditions et suppressions anciennes ne font pas l'objet d'une réconciliation Events API. Une reconnexion ou un changement du réglage de partage redémarre une passe initiale, avec déduplication des données déjà présentes.

## Vérification

- `npm test` : tests applicatifs et handlers Slack simulés (authentification, état OAuth, Vault en erreur, confidentialité, pagination, fils anciens, rate limits, révocation, déduplication).
- `npm run build` : TypeScript et build Vite.
- `npx deno check --no-lock supabase/functions/connect-slack/index.ts supabase/functions/sync-slack/index.ts` : vérification des Edge Functions.
- `supabase/tests/slack-isolation.sql` : à exécuter **uniquement dans une base PostgreSQL temporaire vide** ; valide la migration, les permissions RLS, l'interdiction de publier une ligne privée et les verrous concurrents.

Un essai OAuth avec une véritable application Slack et l'application des migrations sur l'environnement Supabase cible restent nécessaires après configuration des secrets.

## Documentation officielle consultée

- [Installation OAuth et scopes utilisateur](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Rotation des jetons](https://docs.slack.dev/authentication/using-token-rotation/)
- [Utilisateurs et emails](https://docs.slack.dev/reference/methods/users.list/)
- [Conversations du titulaire](https://docs.slack.dev/reference/methods/users.conversations/)
- [Historique](https://docs.slack.dev/reference/methods/conversations.history/)
- [Réponses aux fils](https://docs.slack.dev/reference/methods/conversations.replies/)
- [Limites API et Retry-After](https://docs.slack.dev/apis/web-api/rate-limits/)
- [Références permanentes aux messages](https://docs.slack.dev/reference/methods/chat.getPermalink/)
# Limites de synchronisation

La première synchronisation lit par défaut les 90 derniers jours, avec un maximum de 1 000 messages par cycle. Les cycles suivants sont incrémentaux. Ces valeurs peuvent être adaptées avec les secrets `SLACK_INITIAL_LOOKBACK_DAYS` et `SLACK_SYNC_MAX_MESSAGES`.

Les messages entrants des canaux publics sont transmis à OpenRouter pour le rapprochement et l'analyse comportementale, avec leur référence Slack. Les canaux privés et messages directs ne sont jamais transmis au modèle et leur corps n'est pas stocké.
