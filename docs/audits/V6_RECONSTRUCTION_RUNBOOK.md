# Reconstruction de la fondation V6

## Périmètre

Ce runbook reconstruit les contrats applicatifs de Phase 1, leur sécurité et la fondation shadow depuis Git. Il ne prétend pas implémenter les phases 2 à 6. Les sources métier et secrets sont des entrées externes ; ils ne sont pas réinventés dans les migrations.

## Validation SQL isolée

```sh
python3 scripts/v6-rebuild-isolated.py --git-ref HEAD
```

Le script crée puis retire son propre conteneur PostgreSQL Supabase, sans réseau, sans port publié et avec l’exécution des crons désactivée. Il initialise le schéma Storage depuis les 67 migrations de l’image officielle `storage-api:v1.72.1` (rôle et search_path de Storage), applique les migrations applicatives et les tests `supabase/tests/v6_*.sql`. Les autres fichiers SQL ont leur propre bootstrap ; ils ne sont pas inclus arbitrairement. L’image PostgreSQL utilisée est `17.6.1.155`.

La validation porte sur PostgreSQL/RLS et les fonctions SQL. Elle ne constitue pas une validation des services HTTP Auth/Storage ni un E2E produit. Les SDK Node installés sont requis séparément pour les tests TypeScript. Les secrets historiques encore présents dans certaines migrations antérieures justifient l’isolement réseau pendant le replay ; les crons effectifs sont remplacés par des commandes paramétrées à la fin.

## Provisionnement d’un nouveau projet Supabase

1. Créer un projet Supabase isolé avec ses schémas gérés Auth et Storage ; appliquer toutes les migrations versionnées, dans l’ordre. Ne pas rejouer aveuglément cet historique sur le projet existant : les anciennes versions locales/distantes sont différentes, leur correspondance est documentée dans l’audit.
2. Déployer les fonctions nécessaires au pipeline : `v6-ingest-events`, `detect-dyad-markers`, `classify-markers`, `score-batch-account-v6`, avec leur arbre d’imports partagé et les flags de `supabase/config.toml`. Les fonctions des connecteurs et consumers existants restent nécessaires tant que les phases suivantes ne les remplacent pas.
3. Configurer les secrets externes. `SUPABASE_URL` et les clés serveur sont fournies par Supabase ; l’accès utilisateur passe par Auth et les RLS. La classification exige `OPENROUTER_API_KEY` et peut préciser `OPENROUTER_ANALYSIS_MODEL`. Aucune valeur secrète ne doit être commitée.
4. Configurer dans `public.app_secrets`, par une connexion administrative, `edge_base_url` (URL du nouveau projet), `edge_gateway_key` (clé JWT de gateway compatible) et `monitor_cron` (secret partagé entre ordonnanceur et handlers). Le dispatcher refuse tout appel tant que ces valeurs manquent. Ne copier ni URL ni credential du projet de test dans un autre environnement.
5. Les 17 noms, horaires et cibles observés sont définis dans `20260917053806_reconstruct_scheduled_workers.sql`. Les jobs Legacy sont conservés jusqu’au remplacement de leurs responsabilités en Phase 5. Ne pas lancer les jobs d’envoi d’emails pendant une validation technique. Vérifier les intégrations tierces et les secrets propres à chaque consumer avant activation sur le nouveau projet.
6. Alimenter le ledger par une ingestion explicite. L’ancienneté de la source ne vaut pas connaissance historique : le premier enregistrement dans le ledger est daté de cette ingestion. Identité, couverture et qualité inconnues restent inconnues ; un snapshot sans preuves admissibles ne devient pas un score autoritaire.

## Authentification des workers

Le handler vérifie la possession exacte du credential serveur configuré ou du `monitor_cron` ; il ne fait jamais confiance à un champ `role` simplement décodé. Un autre JWT legacy valide au gateway peut donc être refusé par le handler s’il diffère du credential configuré. Les crons observés utilisent `x-cron-secret`, chemin vérifié par le test distant. Les tests anonymes renvoient 401. Les clés restent en mémoire pendant les vérifications et ne sont pas exportées.

## Écarts intentionnels avec l’inventaire historique

- `fiche_shares` et ses anciennes routines sont retirés par une migration déjà présente ; le partage utilise `fiche_visions`/`fiche_vision_grants`.
- Les sept RPC récupérées conservent leurs résultats de compatibilité mais leurs droits sont corrigés.
- Le ledger, ses sept RPC et les quatre handlers utilisent la fondation shadow. Ils ne remplacent pas encore tous les scores UI, historiques ou recommandations.
- Les deux Edge Functions distantes absentes du code (`enrichment-agent-selftest`, `generate-relationship-narrative`) ne font pas partie du pipeline de fondation. Leur statut et les consumers Legacy restent à traiter aux phases prévues.

Les preuves de replay depuis Git, de parité des sources déployées et d’intégrité distante se trouvent dans les fichiers `v6-phase1-*-validation.json`, `v6-phase1-edge-readback-comparison.json` et `v6-phase1-foundation-remote-integrity.json`.
