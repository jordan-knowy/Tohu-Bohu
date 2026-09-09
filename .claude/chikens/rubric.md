# Barème Chikens — risque back-end (0 → 100)

Le "back-end" de ce projet = tout ce qui n'est pas rattrapable par un simple redéploiement front :

| Zone | Où |
|---|---|
| Schéma & données | `supabase/migrations/*.sql` (tables, colonnes, vues, index) |
| Sécurité | policies RLS, `security definer`, `super_admins`, vault OAuth (`oauth_token_vault_functions`) |
| Logique serveur | RPC / fonctions SQL, triggers, `sync_jobs`, cron (`schedule_*_cron`) |
| Secrets & config | `.env`, `.env.example`, `.mcp.json`, `supabase/config.toml` |
| Contrats client↔serveur | `src/services/**`, `src/lib/**` (client Supabase), `package.json` |
| Routage / déploiement | `netlify.toml`, `vite.config.ts` |

## Bandes

- **0–9 — Nul.** Question, lecture, doc, commentaire, copy. Aucun fichier de code touché.
- **10–29 — Très faible.** Front pur : composants, styles, HTML, textes. Consomme l'existant sans changer une requête.
- **30–49 — Faible.** Nouvelle requête *lecture seule*, nouveau champ affiché, ajout dans `src/services` sans écriture ni migration.
- **50–69 — Moyen.** Migration **additive** (table/colonne nullable, index), nouvelle RPC, nouveau code qui **écrit** en base, nouvelle dépendance npm.
- **70–84 — Élevé.** Modification de l'existant : colonne renommée/typée, policy RLS modifiée, RPC existante changée, cron, auth/onboarding, quotas & entitlements, ownership/tenancy (`owner_user_id`, memberships), facturation.
- **85–100 — Critique.** Irréversible ou exposant : `DROP` / `DELETE` / `TRUNCATE` / backfill destructif, migration sans rollback, `disable row level security`, secrets (`.env`, clés service_role), `super_admin`, données de prod, suppression de compte.

## Modificateurs (+/-)

- `+10` la demande est vague ("nettoie", "optimise", "refacto") → périmètre non borné.
- `+10` touche plusieurs zones à la fois (schéma **et** RLS **et** client).
- `+15` demande de déployer / pousser / lancer une migration en plus d'écrire le code.
- `-10` demande explicitement bornée à un fichier ou un composant nommé.
- `-10` la migration est réversible et le rollback est écrit.

## Libellés

`0-9 NUL` · `10-29 TRÈS FAIBLE` · `30-49 FAIBLE` · `50-69 MOYEN` · `70-84 ÉLEVÉ` · `85-100 CRITIQUE`
