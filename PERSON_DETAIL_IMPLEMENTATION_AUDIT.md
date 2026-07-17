# Audit d'implémentation — Fiche Personne Tohu

Date : 16 juillet 2026

## Résumé exécutif

La référence visuelle `tohu-personne-jordan-chekroun.html` a été localisée
(`~/Desktop/tohu-livrable/`) et auditée intégralement (1 806 lignes, fonts et
images embarquées en base64). C'est une page de démonstration autonome : toutes
les données sont celles de Jordan Chekroun, codées en dur, et toutes les
interactions sont simulées en JavaScript inline.

Côté application, la route React `/app/people/:personId` existe déjà dans
`src/react-app/main.tsx` mais rend un stub minimal (`PersonPage`) branché sur
`getPersonDetail(id)` de `src/app/data.ts` — un hero simplifié sans aucun des
blocs de la référence. La fiche Compte (`/app/accounts/:accountId`) livrée au
lot précédent fournit le shell React (`AppShell` + `Outlet`), les patterns de
service agrégé, la migration RLS type et les composants génériques à réutiliser.

La mission consiste donc à : porter fidèlement le design de la référence en
composants React alimentés par Supabase, créer les persistances Personne
manquantes (miroir du P0 Compte), et brancher chaque action visible.

## Blocs présents dans la référence

1. **Nav sticky** (marque Tohu + identité) — remplacée par l'`AppShell` React
   existant, comme pour la fiche Compte.
2. **Hero sombre** (`.hero-header`, fond `--night`, halo violet) :
   - nom (`hero-name`), sous-titre poste · entreprise · domaine · localisation ;
   - chip **Relation** (type relationnel : Prospect / Client / Partenaire /
     Fournisseur / Investisseur / Interne / Réseau) avec menu contextuel ;
   - chip **Rôle** (rôle décisionnel : Initiateur / Utilisateur / Influenceur /
     Filtre / Décideur / Acheteur) avec menu contextuel ;
   - pills complémentaires (rôle pro, autre organisation) ;
   - **accroche** (`k-accroche`) : synthèse courte de la personne ;
   - **score relationnel** (54 px, libellé « NPS relationnel » dans la démo) +
     tendance ;
   - **anneau de confiance** (conic-gradient) ;
   - photo (ou initiales).
3. **Cartes de contrôle** (`.kctrl`) : compte associé (« Voir la fiche
   compte → ») + veille Tohu (toggle Activée/Désactivée).
4. **Barre de connecteurs** (`.ctx-grid`) : tuiles source (Outlook, Read AI,
   LinkedIn, Internet) avec LED on/off + bouton « Gérer les connecteurs ».
5. **Section « Notre relation »** (`#sec-mem`, repliable `.csec`) :
   - stats (score, ancienneté, échanges) + ligne de provenance ;
   - **courbe score** en barres mensuelles, fenêtres 6 / 12 / 36 mois, tooltip
     par point (date, score, delta, contexte), légende, barre « live sync » ;
   - **3 cartes dimensions** : Intensité, Réciprocité, Récence (valeur /100,
     barre, note, provenance) ;
   - bandeau « Vue équipe » (NPS organisation + invitation équipe).
6. **Section « Recommandations »** (`#sec-reco`) :
   - pills de filtre (Toutes / Posture / Actions) + compteur d'actions ouvertes ;
   - **carte Coaching** (posture) : socle observé (« S'appuyer sur » /
     « Éviter »), « Ce qui évolue » (tags nouveau / se renforce / s'atténue),
     bouton « Simuler un échange », feedback « Lecture juste ? » (👍 / 👎) ;
   - **cartes Action** (Tâche / Mouvement) : titre, justification, signal
     déclencheur, priorité, boutons « Fait » / écarter avec animation de sortie.
7. **Section « Profil comportemental · Cercle interpersonnel »**
   (`#sec-profil`) :
   - radar SVG (axes assertif/conciliant × distant/chaleureux, quadrants
     Dominant / Influent / Analytique / Stable) avec halo animé et position ;
   - popover **Preuves** (verbatims, modèle académique, source) ;
   - lecture synthétique + bandes d'actes de langage (Directif, Commissif,
     Assertif, Interrogatif, Expressif) ;
   - sliders « Style d'échange » (Tempo, Ouverture, Orientation, Certitude) ;
   - **marqueurs observables** repliables (7 cartes : temps de réponse,
     dominance, synchronie, pronoms, registre, auto-divulgation, posture) avec
     points de confiance et source.
8. **Section « Parcours · CV vivant & veille »** (`#sec-cv`) : badge « Live CV ·
   synchronisé LinkedIn », timeline (poste actuel + formations), replis « voir
   le parcours complet », pied de synchronisation.
9. **Carte « Nourrir le profil »** (`.feed-card`) : note texte, fichier, note
   vocale (enregistrement + durée), bouton Enregistrer, liste des ajouts
   « à valider ».
10. **Carte « Historique relationnel »** (injectée par script) : sparkline
    échanges/mois, stats (premier échange, total, dernier contact, pic),
    timeline de jalons par année, granularité Mois / Année, repli.
11. **Rail latéral** (`.rail`) : **Coordonnées** (email, téléphone, bouton
    Copier, badge Sync) et **Signaux récents** (icône, titre, fait observé,
    confiance, source, date, tag, « Voir + »).
12. **Widget favori** (`.kfav`, injecté par script).

## Données statiques à remplacer

Tout est codé en dur sur Jordan Chekroun : nom, photo JPEG base64, poste,
localisation, type de relation « Interne », rôle « Décideur », accroche, score
88, tendance, confiance 82 %, `NPSDATA` (4 mois de courbe), dimensions 96/84/92,
carte coaching et ses listes, 3 cartes action (+ file `aq` de suivantes),
mutations simulées (`mut`), radar et ses preuves, bandes de langage, sliders,
7 marqueurs observables, CV (WebFitYou, Sorbonne, Toulouse Capitole),
coordonnées (jordan@tohu.co, téléphone), 7 signaux, historique relationnel
(sept. 2025 → juin 2026), compte « WebFitYou », état des 4 connecteurs.

## Fonctions actuellement simulées dans la référence

- `setNps()` : courbe tirée d'un objet statique ;
- `krsDone()` / `krsFb()` : action « fait/écarté » et feedback purement DOM ;
- `krsSim()` : « simuler un échange » rejoue des mutations pré-écrites ;
- `feedSave()` / `feedFilePick()` / `feedVoice()` : mémoire non persistée,
  enregistrement vocal factice (chronomètre sans capture micro) ;
- `ktoggle()` : veille non persistée ;
- `setRel()` / `setRole()` : menus relation/rôle non persistés ;
- `sigFb()` : validation de signal non persistée ;
- `copyTxt()` : seul comportement réellement fonctionnel (presse-papiers) ;
- `toggleSec()`, `toggleCV()`, `toggleObs()`, carrousel de recommandations :
  UI locale de démonstration.

## Existant applicatif réutilisable

- `AppShell` React + `Outlet`, routes `/app/accounts/:accountId`,
  `/app/people/:personId` (stub), `/app/signals`, `/app/ask`
  (`src/react-app/main.tsx`).
- `getPersonDetail(id)` minimal dans `src/app/data.ts` (contacts +
  behavioral_signals + meeting_participants) — sera remplacé par un service
  dédié `src/person-detail/service.ts` (miroir de `src/account-detail/`).
- `saveSignalFeedback()` (table `signal_feedback`, upsert par
  `user_id,signal_id`) — réutilisé tel quel.
- `signalTitle()` (`src/app/signal-labels.ts`) pour libeller les signaux.
- Patterns fiche Compte : `Section` repliable, `Empty`, skeleton, états
  404/erreur, dialogues, mutations + `refresh()`.
- Tokens design (`src/styles/tokens.css`) strictement identiques au `:root`
  de la référence — le CSS de la référence est portable tel quel.

## Tables Supabase existantes (données réelles au 16/07/2026)

- `contacts` (107 lignes) : identité, `role_title`, `company_id`,
  `owner_user_id`, `avatar_url`, `location`, `enrichment_data` (jsonb, contient
  `phone`/`status`), `web_bio`, `merged_into_contact_id`.
- `companies` (32) : compte associé.
- `relationship_snapshots` (0) : `engagement_score`, `phase`,
  `last_contact_at`, `snapshot_date` par contact.
- `contact_score_history` (1 993) : historique de score par contact
  (`organization_id`, `contact_id`, `user_id`, `snapshot_date`, `created_at`
  + colonnes de score à confirmer à l'application de la migration).
- `nps_snapshots` (191) : snapshots NPS par contact (shape à confirmer).
- `cognitive_profiles` (67) : `global_confidence`, `executive_summary`,
  `cognitive_mode`, `behavioral_analysis_data` (jsonb `{trait, observation,
  confidence}`), `updated_from`, `updated_at`.
- `behavioral_signals` (181) : `signal_type`, `text`, `inference`,
  `inference_level`, `confidence`, `source_type`, `source_ref`, `observed_at`
  — sert de signaux Personne **et** de preuves comportementales.
- `signal_feedback` (2) : verdict confirmé/infirmé par utilisateur.
- `meetings` (312) / `meeting_participants` (1 062) : interactions réunion.
- `communication_threads` (181) / `communication_messages` (233) :
  métadonnées d'emails (aucun corps stocké).
- `connectors` (4) : provider, status, `last_synced_at`, `metadata.last_error`.
- `contact_career_path` (0), `contact_alerts` (0), `contact_topics` (0),
  `notes` (0) : présentes mais vides, shapes héritées non versionnées.
- `profiles`, `memberships`, `organizations` : identité et workspace.
- Tables P0 Compte (`account_*`) : modèle de référence pour le miroir Personne.

## Colonnes / persistances manquantes

Aucune table ne couvre aujourd'hui, côté Personne :

- rôles qualifiés (type de relation, rôle décisionnel, rôle relationnel) ;
- favori et veille par utilisateur ;
- snapshots de score canoniques avec dimensions
  (intensité / réciprocité / récence) et confiance, écrits par le backend ;
- recommandations (coaching + actions) avec statut, feedback et provenance ;
- coordonnées multiples vérifiées avec visibilité et historique de correction ;
- mémoire relationnelle (notes, fichiers, notes vocales) avec provenance ;
- parcours professionnel sourcé avec statut de vérification ;
- synthèse (accroche) sourcée et datée.

## Migration nécessaire

`202607170001_person_detail_p0.sql` (miroir du P0 Compte) :

- `person_settings` : relation, rôle décisionnel, rôle relationnel, owner
  principal, visibilité, archivage — 1 ligne par (organization, contact) ;
- `person_user_settings` : favori + veille par utilisateur (structure §23 de
  la mission) ;
- `person_relationship_score_snapshots` : score 0-100, phase, delta,
  dimensions (intensité, réciprocité, récence), confiance, volumes
  d'interactions, `computed_at` — lecture seule côté client, écriture
  service role ;
- `person_recommendations` : `kind` coaching/action, catégorie, titre,
  justification, action recommandée, signal déclencheur, priorité, échéance,
  statut (open/in_progress/completed/dismissed/postponed), feedback
  (utile / pas juste), provenance ;
- `person_contact_details` : type, valeur, label, principale, statut de
  vérification, visibilité, provenance, archivage ;
- `person_contact_detail_revisions` : historisation des corrections
  (ancienne valeur, auteur, date) ;
- `person_memory_entries` : note / fichier / vocal / décision / engagement /
  préférence / risque, contenu, chemin fichier, transcription, visibilité,
  statut de traitement ;
- `person_career_entries` : poste, organisation, période, type
  (expérience / formation), statut confirmé / probable / à confirmer /
  infirmé, provenance ;
- `person_summaries` : accroche sourcée (texte, confiance, `generated_at`),
  écriture service role ;
- bucket privé `person-memory` + policies storage ;
- RLS par `private.is_org_member(organization_id)` + triggers de cohérence
  workspace (même patron que `validate_account_detail_scope`).

Le service lira la courbe depuis `person_relationship_score_snapshots` et, à
défaut, depuis l'historique existant `contact_score_history` /
`relationship_snapshots` (vraies données, jamais de courbe inventée).

## Fichiers à modifier / créer

- `src/person-detail/types.ts` — contrat `PersonDetailData` +
  `DataSourceReference` (champs incertains nullables) ;
- `src/person-detail/service.ts` — `getPersonDetail(workspaceId, personId)`
  agrégé (une passe `Promise.all`, pas de N+1) + mutations (favori, veille,
  rôles, recommandations, feedback, coordonnées, notes, fichiers, carrière,
  signaux) ;
- `src/person-detail/mapping.ts` — fonctions pures de mapping (testables) ;
- `src/person-detail/PersonDetailPage.tsx` — page + composants (hero,
  connecteurs, relation, recommandations, profil comportemental, parcours,
  mémoire, historique, rail coordonnées/signaux) ;
- `src/styles/person-detail.css` — port fidèle du CSS de la référence,
  préfixé `.pp` pour éviter toute collision ;
- `src/react-app/main.tsx` — remplacement du stub `PersonPage` ;
- `supabase/migrations/202607170001_person_detail_p0.sql` ;
- `src/person-detail/__tests__/*.test.ts` — scénarios §33.

## Risques

- Le shape exact de `contact_score_history` / `nps_snapshots` (tables héritées
  non versionnées) doit être introspecté avant branchement de la courbe — accès
  MCP requis (indisponible ponctuellement pendant l'audit).
- Le radar interpersonnel exige des axes calculés côté backend ; tant que
  `cognitive_profiles` ne les fournit pas, la section affiche l'état
  « Analyse comportementale insuffisante » avec le seuil manquant (jamais de
  position inventée).
- La note vocale dépend des autorisations micro du navigateur ; la
  transcription est asynchrone (`processing_status`), aucun traitement n'est
  simulé.
- Deux shells coexistent (vanilla `tohu-app.html` + React `/app/*`) ; la liste
  Personnes vit encore dans le shell vanilla.
- Pas de navigateur automatisable ni de session seedée : les tests E2E complets
  restent limités aux tests unitaires de mapping + vérification manuelle.
- `signal_feedback.signal_id` n'a pas de FK stricte vers `behavioral_signals`
  (créée pour les signaux Compte) — vérifier la contrainte avant réutilisation.

## Périmètre P0 (obligatoire)

- route dynamique réelle + états chargement / 404 / accès interdit ;
- design fidèle à la référence (hero, sections repliables, rail, animations) ;
- identité + rôles persistés + accroche sourcée (ou état insuffisant) ;
- compte associé + navigation `/app/accounts/:accountId` ;
- score backend + phase + dimensions + courbe sur vraies données 6/12/36 mois ;
- connecteurs réels ; « Gérer les connecteurs » ;
- recommandations persistées + actions (fait / reporter / écarter / feedback) ;
- signaux sourcés + confirmation / infirmation persistées ;
- coordonnées persistées (copier, ajouter, modifier avec historique) ;
- notes texte + fichiers persistés (bucket privé) ;
- favori + veille persistés ;
- Ask Tohu contextualisé (`/app/ask?personId=`) ;
- RLS testées, responsive, états vides, tests unitaires, build/typecheck/lint.

## Périmètre P1 (après P0)

- radar comportemental alimenté par le moteur backend (axes circumplex) ;
- note vocale avec transcription automatique ;
- extraction IA des faits depuis les notes (validation humaine) ;
- parcours enrichi automatiquement (LinkedIn) + résolution de conflits ;
- vue équipe réelle (NPS organisation multi-boîtes) ;
- owners secondaires + permissions granulaires + historique des attributions ;
- simulation conversationnelle avancée ;
- moteur backend produisant recommandations et snapshots de score.
