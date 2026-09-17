# V6 — Définitions distantes inconnues (historique)

> **État dépassé.** Les sept définitions ont été récupérées dans `v6-phase1-remote-rpcs.sql`, puis versionnées et sécurisées dans le commit `89defea`. Voir `PHASE_1_ETAT_DISTANT.md` pour l’inspection et `PHASE_1_REMEDIATION.md` pour les corrections. Le texte ci-dessous conserve le contexte du blocage initial.

## Connexion MCP ajoutée

Le serveur Codex `supabase` est configuré pour le projet `bgmtzwfafcgjklgygvtx`. La commande de connexion a confirmé sa réussite avec les scopes de lecture `organizations:read,projects:read,database:read,analytics:read,edge_functions:read,environment:read,storage:read` ; `codex mcp list` indique `enabled / OAuth`. Les skills `supabase` et `supabase-postgres-best-practices` sont installés dans `.agents/skills`.

L'accès effectif n'est cependant pas validé : la session courante échoue à initialiser ce serveur avec « OAuth refresh credentials … are missing an authorization server issuer; authorization required ». Recharger la session Codex puis contrôler `/mcp` et effectuer une lecture avant de considérer la connexion opérationnelle. Si l'erreur persiste dans une nouvelle session, renouveler l'authentification depuis cette session. Aucune définition SQL distante n'a été récupérée par ce MCP à ce stade.

17 septembre 2026. Nouvelle tentative Phase 1 en lecture seule : `supabase functions list --project-ref bgmtzwfafcgjklgygvtx --output json` refuse l'accès (« account does not have the necessary privileges »). `supabase migration list --linked` échoue : checkout non lié. Aucun secret affiché, aucune écriture distante. Configuration gateway/JWT et ACL distantes **non vérifiées**.

Les sept fonctions ci-dessous **n'ont pas été inventées ni redéfinies**. Les anciens producteurs V6 ont été remplacés localement par le ledger explicite `v6_foundation_*` (nouveaux noms, nouvelles tables, aucun déploiement), ce qui retire leurs dépendances aux écritures inconnues. Les consommateurs produit existants restent à migrer ultérieurement.

| RPC | Consumer avant Phase 1 | Contrat attendu | Risque / définition distante | Action nécessaire |
|---|---|---|---|---|
| `upsert_person_marker_events` | detect-dyad-markers, classify-markers | Organisation + liste d'événements → nombre écrit | Inconnue : validation, dédup, attribution dyadique, droits | Extraire `pg_get_functiondef`, ACL et contraintes ; comparer avant retrait définitif |
| `upsert_dyad_weather_snapshot` | score-batch-account-v6 | IDs contact/compte/org, mois, version, axes, score, qualité → écriture | Inconnue : clé contact vs collaborateur, valeurs nulles | Export lecture seule ; retirer après remplacement validé |
| `upsert_account_weather_snapshot` | score-batch-account-v6 | Compte/org, mois, versions, cadrans, score/delta → écriture | Inconnue : fiabilité/verdict implicites, conflits | Export et revue avant retrait |
| `get_account_prev_weather_score` | score-batch-account-v6 | Compte, mois, versions → ancien score | Inconnue : choix de borne et version | Export ; ne pas utiliser pour nouveau rejeu |
| `get_dyad_weather_snapshot` | src/person-detail/service.ts | Contact → snapshot axes/score/statut/verdict | Inconnue : visibilité, scope collaborateur, priorités | Export et audit `SECURITY DEFINER`, `search_path`, GRANT/REVOKE, RLS |
| `get_account_dyad_snapshots` | src/services/account-brain/accountBrain.ts | Compte → snapshots des personnes/dyades | Inconnue : personnes agrégées, périmètre, droits | Même audit + contrat personne/équipe avant migration |
| `account_health_monthly` | src/account-detail/service.ts | Compte et nombre de mois → ym/score | Inconnue : sources Legacy, bornes, sécurité | Export puis retrait avec l'historique Legacy en Phase 2 |

Récupération attendue avec une connexion autorisée : `pg_proc`/`pg_namespace`, `pg_get_functiondef(oid)`, `proacl`, propriétaires, `prosecdef`, `proconfig` et policies des tables lues. Ne pas supposer les signatures exactes à partir des arguments JS ; relever les overloads. Contrôler le gateway réellement déployé avant d'affirmer qu'un chemin JWT était exploitable.

Les migrations Phase 1 incluent seulement de nouvelles RPC `v6_foundation_*` et les fonctions **déjà versionnées** de résolution d'identité et lecture de markers. Une base PostgreSQL locale n'a pas pu être démarrée : client psql disponible mais pas de serveur local, daemon Docker indisponible. L'exécution SQL et les ACL réelles restent des conditions de validation, distinctes des tests mockés.
