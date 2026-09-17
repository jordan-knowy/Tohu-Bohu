# Phase 1 — inspection distante du moteur relationnel V6

> **Verdict actuel après remédiation : reconstruction des fondations depuis Git YES ; GO Phase 2.** Voir `PHASE_1_REMEDIATION.md` et ses preuves. Le texte ci-dessous conserve l’inspection avant correction : ses mentions NO GO et absence d’écriture décrivent cet état historique, pas la situation après remédiation.

Date : **17 septembre 2026** (Asia/Jerusalem ; captures SQL le 16 septembre, à partir de 22:13 UTC). Projet : `bgmtzwfafcgjklgygvtx`. Git HEAD : `f34a7f5b216fa708c128f75ce441093b808d9ed1`, avec le working tree antérieur conservé.

**Reconstruction depuis le Git actuel : NO. GO Phase 2 : NO GO.**

L'ancien blocage total est levé : les sept RPC, le catalogue SQL, les ACL, les crons, les migrations enregistrées, les sources Edge et les comptages ont été récupérés. L'inspection révèle des défauts de sécurité et de pipeline réels ; elle ne valide pas la fin de Phase 1. Aucun correctif applicatif, migration, DELETE, DROP, reset, changement de cron, déploiement ou écriture distante n'a été exécuté. Aucune fonction métier distante n'a été invoquée. Seuls ce rapport et ses pièces d'audit locales ont été écrits.

## Niveaux de preuve et accès

- **VERIFIED LOCAL** : fichiers lus dans le checkout, Git, empreintes et tests locaux. Cela ne signifie pas « commité » ni « déployé ».
- **VERIFIED REMOTE** : réponses MCP ou API Supabase, catalogues, définitions déployées et agrégations SQL. L'analyse statique d'une fonction déployée prouve son code, pas la réussite de chacun de ses appels.
- **UNKNOWN** : contrôle non effectué, preuve insuffisante ou résultat non reconstructible. Jamais remplacé par zéro.

**VERIFIED REMOTE — connexion.** `/mcp` est une commande de l'interface utilisateur ; elle n'a pas été exécutée comme commande shell. Les appels MCP réels `get_project_url`, `list_migrations`, `list_tables`, `list_extensions`, `get_advisors`, `list_edge_functions` et `get_edge_function` ont fonctionné. `execute_sql` a échoué deux fois avec `Insufficient scope`, y compris pour `SELECT 1`. Le premier jeton fourni ensuite a reçu `401 Unauthorized`. Le second a permis l'accès à l'[endpoint SQL en lecture seule](https://supabase.com/docs/reference/api/v1-read-only-query), sous **`supabase_read_only_user`**, PostgreSQL **17.6**. Le MCP SQL lui-même n'a pas été réparé ; l'inspection a continué par cette API autorisée.

Les jetons fournis ne figurent dans aucune pièce d'audit ; le fichier temporaire de credentials a été supprimé après les lectures. Les JWT historiques présents dans les migrations ont été masqués, ainsi que deux statements portant des secrets. Les commandes de cron ne sont pas exportées brutes : cible, horaire, attributs non secrets et empreinte seulement. Aucun corps d'email, transcript ou texte de preuve issu des données métier n'a été exporté.

Les lectures successives ne constituent pas un snapshot transactionnel global : les crons existants continuaient à tourner. Chaque capture SQL principale conserve sa requête et son horodatage. Les valeurs `rows` du premier inventaire MCP étaient des métadonnées, **pas des comptages exacts** : par exemple `cron.job` annonçait 10, alors que la lecture réelle en trouve 17 ; `subscription_plans` annonçait 0, contre 7 au COUNT. Les chiffres ci-dessous utilisent les requêtes SQL exactes.

## VERIFIED LOCAL — reprise du travail existant

Les audits Phase 0, le précédent complément Phase 1, `V6_REMOTE_GAPS.md`, les reproductions, l'index des dépendances et le manifeste local ont été repris. Le corpus des 139 migrations a été parcouru pour l'inventaire et la comparaison des objets ; les cinq migrations non suivies et les migrations V6/sécurité concernées ont été examinées. L'index lexical complet en annexe ne remplace pas un replay SQL.

- **139 migrations locales, 134 suivies par Git et 5 non suivies**. Leurs 139 SHA-256 sont identiques au manifeste de la session précédente. Aucun fichier de migration supprimé, renommé ou écrasé.
- **38 points d'entrée Edge locaux**, dont `v6-ingest-events`, non suivi.
- **32 fichiers suivis modifiés** au démarrage, plus les fichiers non suivis : ne pas attribuer tout ce travail à cette inspection ni tout fusionner dans un commit Phase 1.
- Les modules frontend réexportent maintenant le noyau partagé dans `supabase/functions/_shared/scoring-v6`. La fondation ajoute le ledger daté par `(organisation, collaborateur, contact)`, normalisation, rejeu, autorisation, checkpoints, observations sémantiques et tests. Les trois handlers V6 locaux utilisent `v6_foundation_*`, tandis que le serveur utilise encore les anciennes RPC.
- `V6_PRODUCT_AUTHORITY = false`. Le runner local est `foundation_shadow` et indique explicitement `account_aggregation: pending_validation`. Cette fondation ne constitue pas encore un moteur produit V6 complet.
- Les modifications de fiche Personne, dismissal des engagements et preuves cognitives se mêlent au working tree Phase 1. Leur attribution historique exacte ne se déduit pas du seul diff.

**Vérifications relancées pendant cette inspection : `npm test -- --reporter=dot` : 414 réussites, 0 échec, 38 fichiers ; `npm run check` : succès ; `tsc -p tsconfig.edge-foundation.json --noEmit` : succès.** Ces tests ne valident ni l'exécution des migrations ni les droits SQL ni la calibration métier.

### Les cinq migrations non suivies

| Fichier local | Contenu constaté | VERIFIED REMOTE | Suite à préparer, sans exécution ici |
|---|---|---|---|
| `20260916150000_person_memory_dismiss.sql` | `dismissed_at` et `dismissed_by` sur `person_memory_entries`, préservation des engagements écartés | Appliqué sous **`20260916183629_person_memory_dismiss`** ; SQL identique hors commentaires/espaces ; colonnes présentes | Réconcilier l'identifiant local avec l'historique distant avant versionnement ; ne pas appliquer deux fois ni réécrire l'historique sans revue |
| `20260916201852_cognitive_profiles_axis_evidence.sql` | `trust_evidence`, `satisfaction_evidence` JSONB + commentaires sur `cognitive_profiles` | Même version et nom ; SQL identique hors commentaires/espaces ; colonnes présentes | Versionner avec le changement produit associé ; ce n'est pas le ledger V6 |
| `20260917100000_v6_foundation_ledger.sql` | 5 tables `foundation_dyad`, `foundation_revision`, `foundation_snapshot`, `foundation_classifier_run`, `foundation_checkpoint` ; 7 RPC `v6_foundation_*` ; RLS et droits service-role | Migration absente de l'historique ; **aucune de ces tables ni RPC dans le catalogue réel** | Versionner après revue/test SQL avec le code Phase 1 dépendant ; aucun déploiement autorisé ici |
| `20260917101000_v6_identity_ambiguity.sql` | Remplacement de `resolve_contact_identity` : refus des emails/noms ambigus | Migration absente ; la fonction distante conserve son ancienne résolution | Versionner comme durcissement Phase 1 après test SQL |
| `20260917102000_v6_marker_read_access.sql` | Contrôle de visibilité dans `get_person_marker_events` / `get_account_k_marker_events`, retrait `PUBLIC`/`anon`, exclusion des markers résolus | Migration absente ; RPC distantes restent sans ces contrôles | Versionner après revue ; **ne couvre pas les six RPC V6 vulnérables détaillées ci-dessous** |

## VERIFIED REMOTE — sept RPC réelles

Les **sept fonctions ont exactement un overload chacune** dans le catalogue capturé, toutes dans `public`, owner **`postgres`**. Les définitions intégrales sont dans [l'export SQL d'audit](v6-phase1-remote-rpcs.sql), les arguments exacts, valeurs par défaut, résultats, ACL et dépendances catalogue dans [l'export détaillé](v6-phase1-remote-rpcs.json). Ce SQL est une archive à revoir, **pas une migration à appliquer**.

### Contrats, comportement et dépendances

| RPC | Paramètres, résultat et mode | Comportement SQL vérifié / rapprochement des consumers |
|---|---|---|
| `upsert_person_marker_events` | `(p_organization_id uuid, p_events jsonb) → integer`, PL/pgSQL DEFINER | Insère dans `scoring.marker_event`, fixe `registry_version='reg-v6.0'`, `scope='person'`. N'écrit **ni `dyad_id` ni `collaborator_user_id`**. Candidat/verbatim absents → false. Conflit `(organization_id,dedup_key)` non nul → **DO NOTHING**, retourne seulement le nombre inséré. Une correction de preuve, résolution ou promotion d'un candidat existant n'est donc pas un upsert effectif. Appelée par les **sources distantes** de classifier/détecteur ; plus par leurs nouveaux handlers locaux. |
| `upsert_dyad_weather_snapshot` | Organisation/contact/compte UUID, `p_at timestamptz`, mois date, versions text, axes jsonb, score/reliability numeric, verdict boolean, statut text → `void`, DEFINER | Insère `entity_type='dyad'`, **`entity_id=p_contact_id`** dans `scoring.score_snapshot`. Axes null → `{}`. Clé conflit `(entity_type,entity_id,snapshot_month,params_version,registry_version)` ; met à jour date, axes, score, fiabilité, verdict, statut, **pas organisation/compte/contact**. Pas de collaborateur. Conforme au batch distant contact-agrégé, incompatible avec une vraie identité dyadique Phase 1. |
| `upsert_account_weather_snapshot` | Organisation/compte UUID, date, mois, versions, cadrans jsonb, score numeric, weakest_dial text, delta numeric → `void`, DEFINER | Écrit un snapshot compte avec **`reliability=NULL`, `verdict_allowed=false`** à l'insertion. Le chemin conflit ne met à jour ni ces deux champs ni l'organisation. Le batch distant ne transmet effectivement aucune fiabilité/verdict. |
| `get_account_prev_weather_score` | `(p_company_id uuid, p_snapshot_month date, p_params_version text, p_registry_version text) → numeric`, SQL STABLE DEFINER | Lit `score_snapshot` sur **le mois fourni exactement**, versions exactes, LIMIT 1. Ce n'est ni une recherche automatique du dernier point ni T−30 jours. Le batch distant lui transmet le mois civil précédent. Aucun historique antérieur à septembre dans les snapshots capturés. |
| `get_dyad_weather_snapshot` | `(p_contact_id uuid) → jsonb`, SQL STABLE DEFINER | Dernier snapshot dyade par `entity_id=contact`, `ORDER BY at DESC LIMIT 1`, sans filtre organisation/collaborateur/version et sans tie-breaker. Renvoie score, fiabilité, verdict, statut, axes et date ; absence → SQL NULL. Le consumer `src/person-detail/service.ts:66` attend bien ces champs ; le contrat ne représente pas la vision personnelle demandée ailleurs. |
| `get_account_dyad_snapshots` | `(p_company_id uuid) → jsonb`, SQL STABLE DEFINER | Dernier snapshot par `contact_id` via DISTINCT ON, sans filtre organisation/version/collaborateur ; JSON array, vide → `[]`. Renvoie contact, score, fiabilité, verdict, statut ; pas les versions/date. Consumer : `src/services/account-brain/accountBrain.ts:143`. L'ordre de l'agrégat final et les ex aequo de date ne sont pas départagés. |
| `account_health_monthly` | `(p_company_id uuid, p_months integer DEFAULT 12) → jsonb`, SQL STABLE **INVOKER** | Dépend de `public.contacts`, `contact_score_history`, `communication_messages`, `meetings`. Population de contacts **actuellement** suivis/non fusionnés, historique Legacy, pondération score par `1+emails`, couverture et récence (55/25/20 % ; demi-vie 90 jours). Mois min 1, sans maximum. Renvoie `{ym,engaged,score}` ; consumer `src/account-detail/service.ts:137` demande 36 mois. Ce n'est pas un historique V6 ni une reconstitution de la population passée. S'exécute avec les droits/RLS de l'appelant. |

Pour les six RPC V6, `search_path=public, scoring, pg_temp` ; pour `account_health_monthly`, `search_path=public`. Les corps des six RPC V6 ne font **aucun appel à `auth.uid`, `is_org_member`, `can_view_contact` ou `can_view_company`**.

Les dépendances de corps sont vérifiées par lecture SQL : cinq fonctions dépendent de `scoring.score_snapshot`, l'insertion de markers de `scoring.marker_event`, l'historique Legacy des quatre tables ci-dessus. `pg_depend` ne renvoie ici que les dépendances de schéma/langage : il ne suit pas les références des corps textuels. Les FK/contraintes, triggers, fonctions et dépendances supplémentaires sont archivés dans le catalogue et [l'inventaire ACL/dépendances](v6-phase1-remote-acl-dependencies.json). Aucun trigger applicatif n'est attaché aux tables `scoring` pour compenser les contrôles absents.

### ACL et sécurité : défaut bloquant confirmé

**Les six RPC V6 sont `SECURITY DEFINER`, owner `postgres` avec `BYPASSRLS=true`, et EXECUTE est accordé explicitement à `anon`, `authenticated`, `service_role` et `postgres`.** Les ACL de ces six fonctions n'ont pas d'entrée PUBLIC ; retirer PUBLIC seul ne retirerait pas les grants explicites. `account_health_monthly` a en plus EXECUTE PUBLIC, mais reste INVOKER.

`has_function_privilege` confirme ces droits effectifs. `public` est exposé par PostgREST, et `anon` y a USAGE. Les RPC d'écriture n'imposent aucun contrôle d'appartenance et les FK vérifient seulement l'existence des IDs, pas leur cohérence d'organisation. Le catalogue et les corps établissent donc une voie SQL de lecture/écriture privilégiée sans autorisation métier pour les six RPC V6. **Aucun appel d'exploitation ni écriture n'a été tenté.** Le contrôle JWT des Edge Functions ne protège pas un appel direct à une RPC PostgREST.

Les ACL permettent de reconstruire l'état des GRANT/REVOKE requis, pas la chronologie de toutes les commandes passées. Les statements de migrations récupérés apportent un historique supplémentaire, qui ne garantit pas l'absence d'interventions manuelles ultérieures.

## VERIFIED REMOTE — Git, migrations et objets

**175 migrations enregistrées à distance contre 139 fichiers locaux (134 dans Git).** [Comparaison complète](v6-phase1-migration-comparison.json) et [statements distants expurgés](v6-phase1-remote-migration-statements.json).

- 72 versions communes ; **103 versions distantes absentes localement**, **67 versions locales absentes de l'historique distant**.
- En rapprochant les noms : **54 paires de même nom à version différente**, **49 entrées distantes sans nom local correspondant**, **14 fichiers locaux sans nom distant correspondant**.
- Ces catégories sont des écarts d'historique, **pas 103 objets absents ou 67 migrations à déployer**. Même nom/version ne prouve pas un SQL identique ; un objet peut provenir d'une migration regroupée ou d'une intervention hors historique.
- Le rapprochement par nom **ou** version produit 126 paires candidates : 105 ont le même texte tokenisé après retrait des commentaires, espaces extérieurs aux littéraux et séparateurs de statements ; 21 diffèrent. Les corps dollar-quoted restent comparés littéralement et les passages expurgés sont signalés : une différence textuelle n'est pas automatiquement une différence sémantique. Le [mapping détaillé](v6-phase1-migration-statement-mapping.json) conserve le résultat de chaque comparaison.
- Les sept RPC ne sont mentionnées dans **aucune migration locale**. Les migrations distantes `20260915200342_account_weather_v6_scoring_schema_rpcs`, `20260915203003_person_marker_events_rpcs`, `20260915205059_dyad_weather_snapshots_and_account_history`, `20260916082150_upsert_person_marker_events_is_verbatim` et `20260826092623_account_health_monthly_rpc` fournissent les pièces qui manquaient.
- `20260915203221_detect_dyad_markers_cron` existe à distance sans équivalent nommé local. Les fondations de `resource_lock`, `access_grant`, `email_preferences`, `email_log`, `email_dispatch_rules` ne sont même pas mentionnées dans les migrations locales recherchées.
- `20260916205657_person_dynamique_axis` est distante sans fichier local : colonnes `person_relationship_score_snapshots.dynamique_score` et `contact_score_history.score_dynamique` présentes. Ne pas les confondre avec le changement UI local réutilisant Engagement comme Dynamique.
- `public.fiche_shares` et ses anciennes RPC existent encore, malgré la migration locale `20260910130000_retire_fiche_shares.sql`. Les helpers distants `private.can_view_contact/company` utilisent déjà `fiche_vision_grants`. Les objets historiques et le remplacement partiel coexistent.

Le [catalogue complet](v6-phase1-remote-catalog.json) contient, pour `public/private/scoring`, **84 tables, 2 vues, 106 fonctions/procédures, 139 policies, 230 indexes et 488 contraintes**, ainsi que **33 triggers applicatifs** sur ces schémas et `auth`. Les noms, colonnes, définitions, owners, ACL, prédicats, états RLS et options des vues sont conservés. Les extensions installées sont `pgcrypto 1.3`, `supabase_vault 0.3.1`, `pg_stat_statements 1.11`, `uuid-ossp 1.1`, `pg_trgm 1.6`, `pg_cron 1.6.4`, `unaccent 1.1`, `pg_net 0.20.3`, `vector 0.8.0`, `plpgsql 1.0`.

[L'index objets local/distant](v6-phase1-local-remote-object-index.json) relie chaque table/vue, fonction, trigger, policy et extension aux migrations locales qui en mentionnent le nom. **Une absence de nom de trigger/policy dans le texte peut aussi provenir de SQL dynamique ; cet index n'est pas une comparaison de schémas reconstruits.** Les statements distants sont archivés pour permettre la réconciliation ultérieure sans inventer leur comportement. L'origine « création manuelle » n'est pas attribuée sur la seule base du drift.

## VERIFIED REMOTE — RLS, ACL et exposition

Configuration API récupérée : **`public,storage,graphql_public`** exposés ; extra search path `public,extensions` ; **`max_rows=1000`**. `scoring` n'est pas directement exposé mais reste accessible via les RPC publiques.

Toutes les tables applicatives inventoriées ont RLS activée. Les policies SELECT de `scoring.marker_event` et `score_snapshot` demandent une appartenance organisationnelle et `private.can_view_contact/company`. Registre et paramètres sont lisibles par les rôles authentifiés. **Cela ne corrige pas le bypass des RPC DEFINER.** Les deux vues applicatives `subscription_usage` et `account_facts_live` sont `security_invoker`.

Les ACL brutes et droits effectifs SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER des relations, USAGE/SELECT/UPDATE des séquences, grants de colonnes, memberships des rôles et default ACL sont archivés. Les seuls grants explicites de colonnes dans le périmètre applicatif concernent `status`, `resolved_at`, `resolved_by` des suggestions de nom/fusion. `anon` et `authenticated` n'ont pas CREATE sur `public/private/scoring` ; `anon` n'a pas USAGE sur `scoring`, mais a USAGE sur `public/private`.

Autres constats déployés :

- `get_person_marker_events` et `get_account_k_marker_events` sont aussi DEFINER, accessibles à anon/authenticated, sans contrôle de visibilité interne. Le premier **n'exclut pas `resolved_at`**. La migration locale Phase 1 corrige ces deux fonctions mais n'est pas appliquée.
- `account_brain` est DEFINER et exécutable anonymement ; son contrôle n'est effectué que **si `auth.uid() IS NOT NULL`**. L'absence d'identité contourne donc ce contrôle. Il marque la météo `available` dès qu'un snapshot existe, même avec fiabilité NULL/verdict false.
- `reconcile_marker_events` est aussi exécutable anonymement en DEFINER, sans garde organisationnelle dans le corps ; il peut déprécier des markers. Il cible seulement S04/source `detector:communication_messages`, alors que la source majoritaire réelle est `detector:detectors-v1`.
- Dans `storage.objects`, la policy **`Org members can manage tohu-documents`** vérifie seulement le bucket et `auth.role()='authenticated'`, sans prédicat d'organisation. La policy `person-memory` vérifie l'appartenance à l'organisation du dossier mais pas la visibilité personnelle de la fiche. Ces règles requièrent une revue avant exposition à plusieurs clients ; aucun objet Storage n'a été lu ou modifié.
- Advisors : 35 fonctions DEFINER signalées exécutables par anon, 66 par authenticated ; huit tables RLS sans policy ; deux fonctions à search_path mutable. Les tables sans policy ne sont pas automatiquement ouvertes : les bypass/ACL restent déterminants. Liens de remédiation [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).

Les [schémas exposés gérés par Supabase](v6-phase1-remote-exposed-schemas.json) et leurs policies/fonctions sont également archivés. **UNKNOWN : tests de non-régression avec de vrais JWT anon/membre/autre organisation et parcours complets de visions.** Le présent audit de catalogue n'est pas une certification générale de sécurité de l'application.

## VERIFIED REMOTE — crons et Edge Functions

### Crons réellement actifs

**17 jobs, tous actifs, timezone `GMT`, utilisateur SQL `postgres`, tous via `net.http_post`.** Aucune cible Edge absente de la liste déployée ; aucun doublon de commande exacte (empreinte). Deux jobs visent `generate-briefs`, avec des bodies distincts : ce n'est pas une preuve de doublon fonctionnel.

| Job | Horaire GMT | Cible |
|---|---|---|
| `tohu-bohu-veille-auto` | `0 */6 * * *` | `monitor-company-news` |
| `tohu-bohu-score` | **`15 */6 * * *`** | **`score-batch` Legacy** |
| `tohu-bohu-veille-contacts` | `30 */6 * * *` | `monitor-contacts` |
| `tohu-bohu-email-backfill` | `45 */6 * * *` | `sync-email-analysis` |
| `tohu-bohu-email-incremental` | `*/10 * * * *` | `sync-email-analysis` |
| `tohu-bohu-briefs` | `*/30 * * * *` | `generate-briefs` |
| `tohu-bohu-digest` | `*/15 * * * *` | `generate-briefs` |
| `tohu-bohu-weekly-digest` | `0 6 * * 1` | `send-weekly-digest` |
| `tohu-bohu-meeting-prep` | `*/5 * * * *` | `send-meeting-prep` |
| `tohu-bohu-alerts` | `50 */6 * * *` | `send-alerts` |
| `tohu-bohu-nurturing` | `0 7 * * *` | `send-nurturing` |
| `tohu-bohu-contact-avatars` | `30 */2 * * *` | `enrich-contact-avatars` |
| `tohu-bohu-google-calendar-sync` | `*/15 * * * *` | `sync-google-calendar` |
| `tohu-bohu-microsoft-calendar-sync` | `3-59/15 * * * *` | `sync-microsoft-calendar` |
| `tohu-bohu-score-v6-account` | **`20 */6 * * *`** | `score-batch-account-v6` |
| `tohu-bohu-detect-dyad-markers` | **`10 */6 * * *`** | `detect-dyad-markers` |
| `tohu-bohu-classify-markers` | **`13 */6 * * *`** | `classify-markers` |

Tous les jobs contiennent un JWT embarqué et une référence à `app_secrets/monitor_cron` ; aucune valeur n'est publiée. [Inventaire expurgé](v6-phase1-remote-crons.json). Les horaires ne constituent pas une barrière de complétude entre étapes.

`cron.job_run_details` contient **21 863 exécutions** à la capture. Sur les sept jours interrogés, les statuts retournés sont `succeeded`, notamment Legacy 28, V6 score 4, détection 4, classification 2. **Cela prouve l'exécution SQL du `net.http_post`, pas le succès HTTP ni applicatif du traitement asynchrone.** Les dates des snapshots prouvent une matérialisation V6, sans permettre d'attribuer chaque ligne à un run donné. Aucun job n'a été déclenché par l'audit.

### Déploiements et sources

**39 Edge Functions déployées, toutes ACTIVE**, contre 38 entrées locales. Les **39 bundles retournés, soit 83 occurrences de fichiers source**, ont été récupérés. [Sources archivées](v6-phase1-remote-edge-sources-all.json), [comparaison SHA-256 avec checkout et HEAD](v6-phase1-edge-comparison.json), [tableau de synthèse](v6-phase1-inventaires.md).

- Local seulement : **`v6-ingest-events`**.
- Distant seulement : **`enrichment-agent-selftest` v10**, **`generate-relationship-narrative` v8**.
- `score-batch` **v31**, `score-batch-account-v6` **v5**, `detect-dyad-markers` **v1**, `classify-markers` **v3**, tous `verify_jwt=true`.
- 51 occurrences de fichiers sont identiques au checkout, 29 diffèrent, 3 n'ont pas de fichier local correspondant. Une même dépendance `_shared` peut exister en versions différentes selon le bundle ; l'identité de l'entrypoint seul ne prouve pas celle de son bundle.
- Les entrypoints déployés de classifier/détecteur correspondent au HEAD antérieur, pas au working tree Phase 1. Le batch V6 diffère des deux. **La fondation Phase 1 n'est pas déployée.**

Le batch distant fixe `channelCoverage=identityResolution=diarizationQuality=1`, `hasX02=false`, utilise `UNQUALIFIED_ROLE`, regroupe par contact, et retient `!coldStart && core` sans filtrer `rompu`/verdict/fiabilité. Son writer compte impose NULL/false. Le classifier déployé traite encore `organizationId` **avant** `isAuthorized`, avec un client service-role. Le code de décodage JWT sans vérification locale est également présent ; `verify_jwt=true` est confirmé au gateway, sans test de contournement. L'absence de contrôle d'appartenance organisationnelle du chemin ciblé reste un défaut distinct.

## VERIFIED REMOTE — données V6 et intégrité

[Comptages exacts](v6-phase1-remote-counts.json), [contrôles principaux](v6-phase1-remote-integrity.json), [contrôles complémentaires](v6-phase1-remote-integrity-extra.json). Les deux comptes fondateurs correspondent à **2 profils, 2 organisations, 2 memberships** ; cela ne signifie pas 2 entreprises CRM : il existe **248 entreprises et 543 contacts**. Il s'agit du contexte de test indiqué par le demandeur, pas d'une population statistique ni d'une preuve de pertinence métier.

| Population | Résultat exact |
|---|---:|
| Contacts / suivis / sans compte / sans owner | 543 / 50 / 115 / 0 |
| `account_contact_roles` | **0** |
| `scoring.marker_registry` / `scoring.scoring_params` | 34 / 2 |
| `scoring.marker_event` | **386**, tous scope person |
| Markers candidats / non candidats | 44 / 342 |
| Markers résolus / dépréciés / futurs / inconnus du registre | 0 / 0 / 0 / 0 |
| Markers sans dyad_id / sans collaborateur | **386 / 379** |
| Contacts / comptes représentés dans les markers | 155 / 96 |
| `scoring.score_snapshot` | **447 = 224 dyades + 223 comptes** |
| Snapshots dyades cold_start / actif / ralenti / rompu | 146 / 8 / 2 / 68 |
| Dyades avec score / verdict true | 78 / 9, dont **6 verdicts sur des relations rompues** |
| Snapshots compte avec score / reliability NULL / verdict false | **223 / 223 / 223** |
| Snapshots hors plage de score/fiabilité / futurs | 0 / 0 |
| Extraction window absente | **447 / 447** |
| Snapshots dyade de contacts non suivis | **210 / 224** |

Tous les snapshots sont au mois **2026-09-01**, versions `params-v6.0-palier` / `reg-v6.0`. Dernière date V6 observée : **2026-09-16 18:20:01.867 UTC**. Aucun historique V6 antérieur dans les lignes présentes. Les 224 « dyades » stockées sont des contacts agrégés (`entity_id=contact_id`), pas les identités `(organisation, collaborateur, contact)` de la fondation.

Répartition des markers : A01=90, A02=102, E02=2, E04=4, E05 candidats=25, R01=1, R02 candidats=19, S04=143. **Aucun marker K, aucun marker C**. Trois E02/E04 sont déclarés verbatim ; la fidélité sémantique n'a pas été vérifiée en lisant les sources.

### Doublons et preuves

- Zéro doublon sur la clé technique `(organisation,dedup_key)` et zéro doublon de clé snapshot.
- **6 groupes de 2 markers** partagent organisation/contact/compte/marker/sens/evidence_ref, avec deux sources distinctes (`detector:communication_messages` et `detector:detectors-v1`). Cela constitue une duplication structurelle interproducteurs à examiner ; zéro doublon technique ne garantit pas l'indépendance des preuves.
- Zéro référence/texte de preuve vide ; zéro incohérence organisationnelle marker↔contact/compte dans le contrôle réalisé.
- **192 références synthétiques** : `channels`=90, `continuity`=102. Les 194 références UUID restantes retrouvent un objet parmi messages, threads, réunions, moments ou engagements. L'existence de cet objet ne valide pas l'attribution, le contenu ni l'indépendance causale.

Pour compter les preuves minimales, la requête exige un marker non candidat, non résolu/non déprécié, un ID connu dans sa version de registre, une preuve non vide et une date ≤ celle du snapshot. C'est un **contrôle nécessaire, pas une validation complète d'admissibilité Phase 1** : les références synthétiques peuvent encore passer, le ledger de connaissance historique n'existe pas et aucun verbatim n'est évalué humainement.

Résultats : **13 snapshots dyadiques avec score n'ont même pas un marker passant ce contrôle à leur date** ; aucun des 9 verdicts vrais n'a moins de cinq références distinctes selon ce filtre minimal. **127 snapshots compte scorés n'ont aucun marker correspondant à leur compte à leur date** ; **220/223** n'ont pas de snapshot dyadique du même mois/version qui soit scoré, actif/ralenti, verdict vrai et reliability ≥0,6. Le premier chiffre compte est un diagnostic de couverture, pas une preuve suffisante à lui seul d'un score invalide : certains cadrans dérivent aussi de messages/participants/rôles. L'absence de provenance complète empêche de certifier leurs preuves admissibles.

### Reliability, coverage et sources

Les scores dyadiques ont reliability entre 0 et 1 ; ceux avec verdict vrai sont ≥0,6. Le code distant montre toutefois que les facteurs de qualité autres que le volume sont fixés à 1 : ces nombres ne mesurent pas la qualité réelle d'identité/canal/diarisation. Les 223 comptes ont un cadran `d_couverture` (0 à 100, dont 81 zéros), mais **aucun rôle qualifié dans `account_contact_roles`** : la qualification effective dépend des fallbacks du code. Cette couverture relationnelle est différente de la couverture d'ingestion.

Les **4 942 messages** ont tous `body_text=NULL`, `source_owner_user_id=NULL`, mais un `metadata.user_id` renseigné. Les métadonnées d'attribution existent donc, sans alimenter la colonne lue par certains consumers. **277 réunions, 652 participants, 1 transcript, 23 mémoires personne, 80 moments clés, 47 faits compte et 47 preuves de faits** sont présents. Un replay sémantique complet des emails ne peut pas être garanti avec la base seule ; leur resynchronisation complète n'a pas été démontrée.

Flags réels : `scoring_v6_ui` et `scoring_v6_dedup` activés pour les deux organisations ; `scoring_v6_shadow`, `account_facts_engine`, `relevance_engine_v1`, `account_brain_v2` désactivés. Des crons, markers et snapshots V6 existent malgré `scoring_v6_shadow=false` : ce flag ne constitue pas un arrêt du pipeline déployé. L'état du frontend réellement servi n'a pas été inspecté.

## VERIFIED REMOTE — Legacy encore présent

Le tableau suivant identifie les objets de stockage relationnel Legacy constatés ; le catalogue conserve toutes leurs colonnes/contraintes/ACL. **Les sources et les descriptions comportementales ne deviennent pas supprimables parce qu'elles partagent une table avec un score.**

| Objet | Lignes exactes | Usage à retirer ou à séparer ultérieurement |
|---|---:|---|
| `public.cognitive_profiles` | 50 | `engagement_score`, `score_phase`, `score_intensite`, `score_reciprocite`, `score_longevite`, `score_delta`, `trust_score`, `satisfaction_score`, `score_engagement`, `score_confiance`, `score_satisfaction`, `score_ancrage` ; reasoning/dates/evidence associés à revoir sans supprimer les descriptions utiles |
| `public.contact_score_history` | 757 | Score/phase/axes Legacy, dont `score_dynamique` distant |
| `public.relationship_snapshots` | 310 | Engagement/phase/évolution/réciprocité/cadence Legacy |
| `public.person_relationship_score_snapshots` | 192 | Score/axes/modèle/historique personne, dont `dynamique_score` |
| `public.account_relationship_score_snapshots` | 107 | Score compte, engagement/recency components, couverture/concentration/historique |
| `public.account_relationship_score_snapshots_dedup_backup_20260910` | 58 | Sauvegarde dérivée encore présente, RLS sans policy |
| `public.person_recommendations` | 239 | Recommandations alimentées par Legacy ; responsabilités utiles à migrer |
| `public.account_recommendations` | 52 | Mélange recommandations Legacy/lecture stratégique/faits ; ne pas supprimer les faits associés |
| `public.account_strategic_readings` | 9 | Synthèses nourries par profils/snapshots Legacy |
| `public.briefs` | 0 | Table existante, consumers et producteurs déployés |

**RPC Legacy confirmée : `account_health_monthly`**. `account_brain` est hybride, mélangeant météo V6 et recommandations/lecture stratégique issues du Legacy. Les fonctions de validation de scope, FK et policies des tables ci-dessus font partie des dépendances à revoir, pas de code mort à supprimer automatiquement.

**Producteur confirmé : `score-batch` v31**, entrypoint et dépendance partagée identiques au checkout, cron actif à `15 */6`. Ses responsabilités comprennent axes, snapshots, qualification et recommandations.

**Consumers distants confirmés par leurs sources :** `generate-briefs`, `send-weekly-digest/assemble.ts`, `account-strategic-reading`, `send-meeting-prep`, `send-nurturing`, `send-alerts`, les synchronisations/analyse comportementale et **`generate-relationship-narrative`**, absent du dépôt. Cette dernière lit les snapshots Legacy et tente de lire/écrire `relationship_score_narratives`, **table absente du catalogue actuel** : consumer orphelin de table identifié. La fonction reste ACTIVE, sans cron trouvé qui la cible ; son éventuel appel extérieur est UNKNOWN.

**Consumers locaux** : listes Personnes/Comptes, Home/priorités, fiche Compte/historique, données partagées/recherche, fiche Personne et appels UI de `score-batch` répertoriés en Phase 0. L'index ancien décrit un état antérieur des handlers : la nouvelle [comparaison Edge](v6-phase1-edge-comparison.json) sépare désormais HEAD, working tree et code réellement servi. Ask Tohu ne fournit toujours pas un contrat V6 unifié ; ses sources distantes sont également archivées.

## UNKNOWN — limites qui subsistent

1. Reconstruction complète sur une base Supabase vide, avec application ordonnée de toutes les migrations et tests SQL d'ACL/pipeline : **non exécutée**. Aucun succès TypeScript ne la remplace.
2. Inventaire historique exhaustif des opérations manuelles, GRANT/REVOKE et modifications d'objets hors migrations : non reconstructible à partir du catalogue seul.
3. Identité sémantique de tous les statements locaux/distants et schéma final d'un replay local : les catalogues et statements sont disponibles, mais les correspondances lexicales et les noms ne prouvent pas cette identité.
4. Réussite HTTP/applicative de chaque cron, traçabilité run→preuves→snapshots, comportement sous vrais JWT/visions et rendu du frontend de production : non validés par cette inspection.
5. Exhaustivité des consommateurs externes au dépôt/bundles récupérés (scripts manuels, clients tiers) et usage réel des deux fonctions uniquement distantes : inconnus.
6. Admissibilité sémantique, fidélité des verbatims, couverture réelle des canaux, rôles temporels et qualité du modèle : non validées. Deux utilisateurs fondateurs ne sont pas un Gold Dataset statistique.
7. Resynchronisation exhaustive des emails/transcripts et reconstitution historique exacte des preuves : non garanties. Les sources doivent être conservées.

## Reconstruction depuis Git : NO

> Si nous supprimions la base de test et reconstruisions Tohu depuis le Git actuel sur une base Supabase vide, obtiendrions-nous exactement l'architecture nécessaire au moteur V6 ?

**NO.** Ce refus repose désormais sur des écarts démontrés, pas seulement sur un défaut d'accès :

1. Le Git commité ne contient que **134 migrations**, pas les cinq fichiers non suivis ni l'ensemble du code Phase 1. Les trois migrations de fondation, sept RPC de ledger et son ingestion ne font pas partie d'une reconstruction depuis HEAD.
2. Les **sept RPC réelles sont absentes des migrations locales**. Trois readers restent appelés dans le frontend local et les anciens writers sont encore utilisés par les fonctions déployées. L'export d'audit ne les intègre pas automatiquement au schéma reproductible ; reprendre leurs grants actuels tels quels reproduirait les défauts de sécurité.
3. L'historique distant comporte des migrations d'objets et de sécurité sans équivalent local identifié, ainsi que de nombreuses versions différentes. `resource_lock`, `access_grant` et les tables d'envoi d'emails illustrent des absences concrètes. Une exécution aveugle des fichiers locaux n'est pas un rattrapage sûr.
4. Les bundles Edge diffèrent de Git et du working tree ; deux fonctions ne sont présentes qu'à distance. Crons et configuration API ne constituent pas encore un état de déploiement reproductible réconcilié. Les secrets devront être injectés hors Git.
5. Même en incluant tout le working tree, la fondation est **shadow**, sans agrégation compte validée ni contrat produit unifié. Legacy reste producteur et autorité de nombreux consumers. L'intégrité réelle présente les défauts détaillés ci-dessus.
6. Le replay SQL sur base vide et les tests de permissions n'ont pas été exécutés. Il n'existe donc aucune preuve de reconstruction exacte, ni de migration sûre de cet état vers V6 unique.

## Décision et suite à soumettre à revue

**NO GO Phase 2.** L'inspection distante est substantiellement réalisée et les inconnues précédentes sont documentées par des preuves ; **la validation de Phase 1 reste refusée** à cause des RPC privilégiées ouvertes, du drift, de l'absence de fondation déployée/reconstructible, des scores sans preuves suffisantes et des limites de qualité/provenance.

Avant décision de suite : réconcilier et versionner proprement migrations/code/configuration à partir des pièces récupérées ; proposer une correction des ACL et guards des RPC exposées, y compris `account_brain` et réconciliation ; valider les migrations et les rôles sur une base isolée ; vérifier le contrat dyadique, l'admissibilité, le recalcul et la couverture ; établir le plan de migration de chaque consumer Legacy. **Ces corrections ne sont pas exécutées par le présent audit.**

La cible demeure **V6 comme unique moteur, Legacy supprimé définitivement**. Aucune obligation de conserver les scores dérivés de test : un reset contrôlé de ces seuls dérivés pourra être préparé après revue des dépendances et preuve du recalcul. Conserver emails/métadonnées, meetings, transcripts, contacts, événements, engagements et preuves utiles au replay/Gold Dataset tant que leur resynchronisation n'est pas garantie. Ne pas supprimer intégralement `cognitive_profiles`, les faits ou les recommandations sans isoler les données sources et les responsabilités utiles.

**Arrêt après livraison du rapport. Phase 2 non commencée.**

## Pièces d'audit

- [Inventaires lisibles : migrations, Edge, tables](v6-phase1-inventaires.md).
- [Manifeste local antérieur, conservé](v6-phase1-local-inventory.json) ; [comparaison des migrations](v6-phase1-migration-comparison.json) ; [mapping vers statements distants](v6-phase1-migration-statement-mapping.json).
- [Migrations distantes expurgées](v6-phase1-remote-migration-statements.json) ; [sept définitions SQL](v6-phase1-remote-rpcs.sql) et [métadonnées/ACL](v6-phase1-remote-rpcs.json).
- [Catalogue SQL applicatif](v6-phase1-remote-catalog.json), [ACL/dépendances](v6-phase1-remote-acl-dependencies.json), [schémas exposés gérés](v6-phase1-remote-exposed-schemas.json), [configuration API](v6-phase1-remote-api-config.json), [index local/distant des objets](v6-phase1-local-remote-object-index.json).
- [Sources Edge](v6-phase1-remote-edge-sources-all.json), [comparaison des fichiers](v6-phase1-edge-comparison.json), [métadonnées MCP initiales et advisors](v6-phase1-remote-metadata.json).
- [Crons](v6-phase1-remote-crons.json), [exécutions cron](v6-phase1-remote-cron-runs.json), [comptages](v6-phase1-remote-counts.json), [intégrité](v6-phase1-remote-integrity.json), [compléments](v6-phase1-remote-integrity-extra.json).
- [Validation locale et préservation des migrations](v6-phase1-inspection-validation.json).
