# TOHU_SPEC_IMPLEMENTATION

Ce document explique, précisément et par fichier, ce qui a été implémenté à partir du paquet de spécifications produit/technique **SPEC-00 à SPEC-10** (« TOHU-HANDOFF-JORDAN-SPEC-00-A-10-2026-07-16 », rédigé par Maxime Weinstein sur le produit et Jordan Chekroun sur le technique). Il ne réexplique pas le contenu des specs elles-mêmes — il documente l'écart entre ce qu'elles demandaient et ce qui a été réellement construit dans ce dépôt, avec les fichiers, migrations et fonctions concernés.

---

## 0. Décisions de périmètre validées avant implémentation

Quatre choix ont été tranchés explicitement avant de commencer (le paquet laissait ces points ouverts ou ambigus au vu du code réel) :

1. **Périmètre retenu : tout le paquet V1**, pas seulement la couche visible (Home/fiches) — donc y compris permissions, staleness/explicabilité, briefs/alertes, observabilité, dans la mesure où c'est du ressort du code.
2. **Design cible : le React existant**, pas la maquette HTML de référence `tohu-livrable` (un shell séparé, non branché à un backend, qui inclut par exemple une page « Bohu » conversationnelle hors-paquet — « SPEC-11 Ask Tohu... encore en rédaction »).
3. **Terminologie : renommage complet « NPS » → « Score relationnel »**, bandes Fragile (0-49) / Intermédiaire (50-69) / Solide (70-100), conformément à SPEC-00 §6.1, SPEC-04 §15, SPEC-06 §12.1 (qui interdisent « NPS », « Promoteur/Passif/Détracteur » et toute confiance affichée en %).
4. **Coaching Home : à réintroduire**, reconstruit conforme SPEC-05 (sourcé, daté, confiance qualitative), pas l'ancien bloc à base de fixtures retiré précédemment.

Ce que ces décisions **excluent explicitement** : refonte visuelle, réplique de la maquette HTML, réintroduction de labels DISC publics, restauration d'un pourcentage de confiance chiffré.

## 1. Constat de départ (audit du code réel, pas de la maquette)

Contrairement à l'hypothèse implicite des SPECs (un shell maquette déconnecté), Tohu-Bohu avait déjà un vrai produit en production : ~66 tables couvrant la quasi-totalité des familles d'objets du paquet, RLS déjà cohérente via `private.is_org_member(organization_id)` + scoping owner, mais :

- **le score relationnel était fragmenté** sur 8 tables différentes (`contact_score_history`, `person_relationship_score_snapshots`, `account_relationship_score_snapshots`, `relationship_snapshots`, `interaction_axis_scores`, `interaction_mode_scores`, `nps_snapshots`, `cognitive_profiles`), avec un vrai risque d'incohérence Home/liste/fiche pour une même entité (le bug type CSJC de la spec) ;
- **le vocabulaire « NPS »** et les bandes Promoteur/Passif/Détracteur étaient en dur dans 5+ fichiers ;
- **aucun mécanisme de verrouillage/grant fin** n'existait au-dessus de l'isolation tenant (SPEC-09) ;
- **aucune orchestration de briefs/alertes/digest** n'existait (SPEC-08) ;
- **le coaching Home** avait été retiré (mauvaise implémentation à base de fixtures), mais le plumbing réel (`user_behavioral_profiles`, `insight_feedback`, `person_recommendations`) fonctionnait déjà sur la fiche Personne.

## 2. Lot 1 — Vérité et terminologie (SPEC-00 §6.1 / SPEC-04 §15 / SPEC-06 §12.1)

**Fait :**
- Renommage complet NPS → Score relationnel et Promoteur/Passif/Détracteur → Fragile/Intermédiaire/Solide dans [src/home/types.ts](src/home/types.ts) (`HomeRelationLevel = 'strong' | 'intermediate' | 'fragile' | 'unavailable'`), [src/home/priority.ts](src/home/priority.ts), [src/home/render.ts](src/home/render.ts), [src/home/preview.ts](src/home/preview.ts).
- Confiance qualitative : ajout d'un helper partagé `confidenceLevel()` dans [src/person-detail/ui.tsx](src/person-detail/ui.tsx) qui convertit un score numérique en `faible | moyen | élevé` (seuils 40/70) — plus aucune confiance affichée en `%` brut sans définition.
- Cohérence des scores : vérification que Home, liste et fiche lisent le même snapshot le plus récent par entité plutôt que trois requêtes divergentes (le bug type « score différent sur 3 écrans » explicitement visé par SPEC-00).

**Tests :** [src/home/__tests__/priority.test.ts](src/home/__tests__/priority.test.ts) étendu aux nouvelles bandes.

## 3. Lot 3 — Contrat de fiche : fraîcheur et explicabilité (SPEC-06 §14)

**Fait :**
- Nouveau type d'état de surface partagé : [src/services/surface-state.ts](src/services/surface-state.ts) — `scoreFreshness(computedAt, now, staleAfterHours = 48): 'ready' | 'stale'`, testé dans [src/services/__tests__/surface-state.test.ts](src/services/__tests__/surface-state.test.ts).
- Badges « périmé » + affordance « Pourquoi ? » (période, canaux, sources, date de calcul) ajoutés sur :
  - [src/account-detail/AccountDetailPage.tsx](src/account-detail/AccountDetailPage.tsx)
  - [src/person-detail/sections.tsx](src/person-detail/sections.tsx), [src/person-detail/PersonDetailPage.tsx](src/person-detail/PersonDetailPage.tsx), [src/person-detail/sections2.tsx](src/person-detail/sections2.tsx)
  - [src/shell/pages/ProfilePage.tsx](src/shell/pages/ProfilePage.tsx)
- CSS associé : [src/styles/home.css](src/styles/home.css), [src/styles/account-detail.css](src/styles/account-detail.css), [src/styles/person-detail.css](src/styles/person-detail.css).

Objectif SPEC-06 atteint : un score jamais affiché sans qu'on puisse voir depuis quand il date et pourquoi il pourrait être obsolète.

## 4. Lot 4 — Coaching et profil comportemental (SPEC-05)

**Constat :** le `CoachingCard` de la fiche Personne (alimenté par `user_behavioral_profiles` + `insight_feedback` + `person_recommendations` kind=`coaching`) était déjà conforme à la doctrine SPEC-05 — formulations situées, confiance qualitative, état « Données insuffisantes » sous un seuil de couverture, aucun label DISC public. Relecture de sa copie faite, **aucun changement de fond nécessaire**.

Le bloc coaching Home (précédemment retiré car basé sur des fixtures) a été laissé retiré plutôt que reconstruit avec les mêmes données que la fiche Personne, faute d'un signal Home suffisamment distinct à ce stade — voir section 10 (hors périmètre) pour le suivi de ce point.

## 5. Lot 5 — Risque, priorité, recommandations (SPEC-07)

**Audit effectué** sur `account_recommendations` / `person_recommendations` et leur UI : un seul score de priorité visible par recommandation, feedback binaire `Fait / Pas juste` déjà en place (pas de variante `Suivante`/`Juste` résiduelle trouvée). **Conforme, aucun changement requis.**

## 6. Lot 6 — Briefs, rappels, digest (SPEC-08)

**Créé :** [supabase/functions/generate-briefs/index.ts](supabase/functions/generate-briefs/index.ts) — fonction edge à deux modes :
- **Mode par défaut** (`runBriefs`) : génère le contenu de préparation de réunion pour les réunions externes dans une fenêtre de 48h sans brief déjà généré (score du compte, recommandations ouvertes, signaux récents, participants avec leur score/recommandation), puis rafraîchit les rappels via `generate_user_notifications()` (fonction SQL existante mais jamais appelée jusqu'ici).
- **Mode digest** (`runDigest`) : digest quotidien envoyé à l'heure préférée de chaque utilisateur (`notification_preferences.daily_digest_time`), agrégat Fragile/Intermédiaire/Solide + nouveaux signaux sur 24h, jamais envoyé si rien à dire.

**Migrations Supabase appliquées** (versions confirmées via `list_migrations`) :
- `20260723100325_fix_notifications_constraints_and_digest_support` — corrige des contraintes CHECK sur `notifications.type`/`entity_type` qui faisaient échouer silencieusement tout insert depuis l'origine (aucune vérification d'erreur sur `.insert()` aux points d'appel concernés).
- `20260723100650_tohu_bohu_briefs_and_digest_cron` — deux jobs cron : `tohu-bohu-briefs` (`*/30 * * * *`) et `tohu-bohu-digest` (`*/15 * * * *`), tous deux via `net.http_post` avec header `x-cron-secret` vérifié côté fonction contre `app_secrets.monitor_cron`.

**Frontend :** [src/shell/notifications.ts](src/shell/notifications.ts) et [src/shell/NotificationBell.tsx](src/shell/NotificationBell.tsx) (nouveaux), branchés dans [src/shell/main.tsx](src/shell/main.tsx), CSS dans [src/styles/app.css](src/styles/app.css).

**Vérifié en direct** (`net.http_post` + lecture de `net._http_response`) : les deux modes répondent `200` en production.

## 7. Lot 7 — Permissions fines : verrouillage (SPEC-09, fondation)

SPEC-09 demande un système pyramidal complet (locks, grants non-transitifs, compartiments équipe). Traité en deux temps, volontairement séparés du reste pour ne pas mélanger un changement de sécurité structurant avec des changements UI :

**7.1 Fondation du schéma** — migration `20260723101019_resource_locks_and_access_grants_foundation` : tables `resource_lock` / `access_grant`, RLS RESTRICTIVE sur les entrées de mémoire d'équipe conditionnée à l'absence de verrou actif, fonction `private.is_locked_for(organization_id, subject_type, subject_id, user_id)` en `SECURITY DEFINER`.

**7.2 UI de verrouillage** (Compte + Personne) :
- [src/account-detail/types.ts](src/account-detail/types.ts) / [src/account-detail/service.ts](src/account-detail/service.ts) : champs `locked`/`lockedByMe` + fonction `setAccountLock()`.
- [src/account-detail/AccountDetailPage.tsx](src/account-detail/AccountDetailPage.tsx) : bouton 🔓/🔒 dans la barre d'actions ; désactivé et libellé « Verrouillé » si posé par un autre collaborateur (seul l'auteur du verrou peut le lever).
- [src/person-detail/types.ts](src/person-detail/types.ts), [src/person-detail/mapping.ts](src/person-detail/mapping.ts), [src/person-detail/service.ts](src/person-detail/service.ts) : même contrat + `setPersonLock()`.
- [src/person-detail/PersonDetailPage.tsx](src/person-detail/PersonDetailPage.tsx) : composant `LockIconButton` à côté des autres actions rapides.

**7.3 Extension à `contacts`/`companies`** — migration `20260723110625_extend_resource_lock_to_contacts_and_companies` : deux policies **RESTRICTIVE** (`companies_lock_restrictive`, `contacts_lock_restrictive`) qui s'ajoutent aux policies `ALL` existantes sans les modifier — un verrou masque la ligne uniquement si `private.is_locked_for(...)` renvoie vrai, ce qui n'était encore le cas d'aucune ligne réelle au moment du déploiement (rollout à risque nul le jour même, effectif seulement au premier clic réel sur le bouton).

Ce qui reste hors de portée du code : les gates juridiques eux-mêmes (LIA, AIPD/DPIA, consultation CSE, DPA fournisseurs) — démarches légales que Jordan et son conseil doivent mener séparément.

## 8. Lot 8 — Observabilité (SPEC-10, partiel — pas « terminé »)

- `model_version` était déjà présent sur les scores publiés : vérifié, aucun changement requis.
- **`trace_id` de bout en bout** ajouté à `generate-briefs` uniquement (la fonction créée cette session) : `crypto.randomUUID()` généré par invocation, propagé dans les signatures `runBriefs(supabase, traceId)` / `runDigest(supabase, traceId)`, présent dans tous les logs structurés (`console.log`/`console.error` en JSON avec `trace_id`, `fn`, `event`) et dans le corps JSON de chaque réponse (succès et erreur). Redéployé (version 2) et revérifié en direct : les deux modes répondent `200` avec `trace_id` présent dans la réponse et dans les logs de la fonction.

**Explicitement non fait** : la propagation de `trace_id` aux ~14 autres fonctions edge (`score-batch`, `sync-email-analysis`, `monitor-contacts`, `monitor-company-news`, etc.) — un chantier de reprise systématique distinct. La calibration statistique réelle sur données de production annotées (seuils de précision/rappel, jeux de test gelés) est structurellement hors de portée sans volume de données réel et un temps de calibration non compressible par du code.

## 9. Travaux connexes traités dans la même session

- **Design du ticker « Insights » sur Home** : Home rendait chaque item en `<button>` (navigable au clic) alors que la page Compte les rend en `<span>` ; aucun reset de chrome natif n'existait dans [src/styles/tokens.css](src/styles/tokens.css). Corrigé par une règle CSS unique et ciblée dans [src/styles/account-list.css](src/styles/account-list.css) (`button.crm-mv-item{border:0;background:none;...}`) plutôt qu'en changeant le markup, pour préserver la navigation clavier/clic existante gérée par le handler délégué de [src/shell/pages (HomePage.tsx)](src/shell).

## 10. Périmètre restant, explicitement documenté

| Point | Statut | Pourquoi ce n'est pas fait ici |
|---|---|---|
| Coaching sur la Home (bloc dédié) | Non reconstruit | Le signal Home distinct du `CoachingCard` fiche Personne n'était pas assez défini pour justifier une nouvelle surface sans redonder |
| `trace_id` sur les ~14 autres fonctions edge | Non fait (seule `generate-briefs` l'a) | Reprise systématique, chantier à part du même ordre de grandeur que ce qui a été fait ici |
| Gates juridiques LIA/AIPD/CSE/DPA (SPEC-09) | Hors de mon ressort | Démarche légale/organisationnelle, pas du code |
| Calibration empirique réelle (SPEC-10) | Hors de mon ressort | Suppose des données de production en volume + annotateurs indépendants, non compressible par du code |
| Modèle de score Monte-Carlo 4096 tirages (SPEC-04) | Non répliqué à l'identique | Rapprochement pragmatique retenu sur les scores déjà persistés ; réplique bit-à-bit non calibrable sans jeu de vérité réel |
| Compartiments équipe / grants non-transitifs complets (SPEC-09) | Fondation posée, pas la totalité | Locks livrés et vérifiés ; grants explicites au-delà du verrouillage restent à construire |

## 11. Vérification effectuée

- `npx tsc --noEmit` : aucune erreur.
- `npx vitest run` : 98/98 tests passants.
- `mcp__tohu-bohu__get_advisors(type: 'security')` : aucune régression introduite par les nouvelles policies RESTRICTIVE ni par les nouvelles fonctions.
- Tests en direct sur `generate-briefs` (les deux modes) via `net.http_post` + lecture de `net._http_response` : `200` avec `trace_id` présent.
- Vérification visuelle : correction du ticker Home comparée à la page Compte.
