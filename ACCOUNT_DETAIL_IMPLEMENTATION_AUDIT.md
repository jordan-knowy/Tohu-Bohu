# Audit d’implémentation — Fiche Compte Tohu

Date : 16 juillet 2026

## Résumé exécutif

La liste Comptes et une ancienne fiche détail existaient dans `tohu-app.html` et
`src/app/main.ts`. Cette fiche était une vue DOM TypeScript simplifiée, ouverte
par paramètre `?view=detail`, sans route canonique, sans React Router, sans
contrat de données complet et sans persistances propres au cockpit Compte.

Le fichier de référence `tohu-compte-csjc.html` n’est présent ni dans le
workspace, ni dans son dossier parent, ni dans les pièces jointes accessibles.
Sa structure exacte, ses données statiques et ses fonctions de démonstration
ne peuvent donc pas être auditées visuellement. L’implémentation reproduit la
direction décrite dans la mission (hero sombre, score, provenance, cartes de
contrôle, cartographie, rails, mémoire et sections repliables), sans reprendre
de donnée CSJC.

## Existant localisé

- Liste Comptes : `tohu-app.html`, section `#view-acc`.
- Chargement de la liste : `listAccounts()` dans `src/app/data.ts`.
- Ancien détail Compte : `openAccount()` dans `src/app/main.ts`.
- Ancienne agrégation : `getAccountDetail(id)` dans `src/app/data.ts`.
- Shell historique : TypeScript DOM, sans React et sans `Outlet`.
- Navigation historique : paramètres `view`/`start`, sans routes métier.
- Design system : `src/styles/tokens.css`, `app.css`, `app-fixes.css`.

## Structure de référence disponible

La mission textuelle impose les blocs suivants :

1. hero sombre, identité et score ;
2. bande de provenance ;
3. sources et veille ;
4. santé et historique ;
5. recommandations ;
6. cartographie des interlocuteurs ;
7. mémoire d’équipe ;
8. anciens contacts ;
9. firmographie ;
10. signaux ;
11. actions et sections repliables.

L’absence du HTML de référence empêche de vérifier les dimensions, espacements,
micro-interactions, diagrammes et variantes exactes.

## Tables existantes identifiées

Le dépôt consomme déjà :

- `companies` : compte, domaine, secteur, type, `public_context`.
- `contacts` : personnes liées via `company_id`.
- `relationship_snapshots` : scores individuels, phase, dernier contact.
- `cognitive_profiles` : confiance individuelle.
- `meetings` et `meeting_participants` : interactions.
- `company_signals` et `behavioral_signals` : signaux.
- `signal_feedback` : validation utilisateur des signaux.
- `connectors` : état et fraîcheur des sources.
- `communication_messages` : métadonnées de messagerie côté backend.
- `memberships` : appartenance au workspace.
- `profiles` : membres de l’équipe.
- `account_strategic_readings` : synthèse stratégique persistée.
- `home_action_states` : actions propres à la Home, non réutilisables telles
  quelles pour les recommandations Compte.

Le schéma initial de ces tables n’est pas versionné dans ce dépôt ; les
migrations locales sont incrémentales et supposent une base Supabase existante.
Le projet Supabase n’est pas lié localement, donc les policies historiques
complètes n’ont pas pu être introspectées.

## Relations compte-personne

- Relation principale actuelle : `contacts.company_id -> companies.id`.
- Owner actuel d’une personne : `contacts.owner_user_id`.
- Aucun modèle existant ne séparait rôle organisationnel, rôle décisionnel et
  rôle relationnel.
- Aucun lien hiérarchique ou d’influence sourcé entre personnes n’est présent.
- Les adresses fonctionnelles ne sont pas encore modélisées séparément.

## Modèle de scoring

- Les scores individuels viennent de `relationship_snapshots.engagement_score`.
- Certains écrans historiques lisaient un score Compte depuis
  `companies.public_context.relationship_score`.
- La Home possède une agrégation locale de repli pour l’affichage. Elle ne
  constitue pas un modèle canonique de score Compte.
- Aucun historique canonique de score Compte n’existait.
- La migration P0 ajoute `account_relationship_score_snapshots`, en écriture
  réservée au backend/service role. La fiche ne calcule aucun score.

## Signaux, tâches et recommandations

- Les signaux sont persistés, datés et disposent d’une confiance.
- `signal_feedback` persiste les confirmations et infirmations.
- Les actions Home ont une persistance spécifique, mais aucun objet
  recommandation Compte complet n’existait.
- La migration ajoute `account_recommendations` avec statut, assignation,
  échéance, dates de complétion/rejet, feedback et provenance.
- Aucune recommandation n’est fabriquée côté client : sans ligne backend,
  l’écran affiche un état vide.

## Connecteurs

- Google Workspace, Microsoft 365 et LinkedIn sont définis dans l’application.
- Les jetons OAuth sont stockés hors du client et protégés par les migrations
  Vault existantes.
- L’état du connecteur est disponible, mais le rattachement exact d’un
  connecteur à chaque interaction reste partiel selon les colonnes de source.

## Composants créés

- `AppShell` : shell React avec `Outlet`.
- `AccountPage` : orchestration de la fiche.
- `SourceStrip` : résumé de provenance et fraîcheur.
- `Health` / `Meter` : santé, snapshots et couverture.
- `Recommendations` : recommandations persistées et mutations.
- `PeopleMap` : vues générale, couverture et pouvoir.
- `Memory` : ajout et lecture de notes d’équipe.
- `Firmographics` : rail de faits sourcés et contradictions.
- `Signals` : rail de signaux et feedback.
- `WatchDialog` : familles de veille persistées.
- `PersonPage` : destination Personne réelle minimale.

## Service principal

`getAccountDetail(workspaceId, accountId): Promise<AccountDetailData>` agrège
en parallèle :

- compte ;
- contacts et snapshots ;
- signaux et feedback ;
- réunions ;
- réglages, favori et veille ;
- snapshots de score Compte ;
- rôles ;
- recommandations ;
- mémoire ;
- faits firmographiques ;
- connecteurs ;
- profils des membres référencés.

Les tables P0 optionnelles produisent un état « données partielles » lorsqu’une
migration n’est pas appliquée. Un compte extérieur au workspace ne peut pas
être chargé, car la requête exige simultanément `organization_id` et `id`.

## Migration ajoutée

`202607160012_account_detail_p0.sql` crée :

- `account_settings` ;
- `account_user_preferences` ;
- `account_watch_settings` ;
- `account_relationship_score_snapshots` ;
- `account_contact_roles` ;
- `account_recommendations` ;
- `account_memory_entries` ;
- `account_firmographic_facts`.

Chaque table porte `organization_id` et `company_id`. Un trigger valide que le
compte, et le contact lorsqu’il existe, appartiennent au même workspace.

## Policies RLS ajoutées

- lecture des données Compte pour les membres du workspace ;
- favoris lisibles et modifiables uniquement par leur utilisateur ;
- score Compte en lecture seule pour les utilisateurs, écriture service role ;
- écriture des notes limitée à leur auteur ;
- validation des facts et mise à jour des recommandations limitées au
  workspace ;
- veille, réglages et rôles limités au workspace et tracés par l’utilisateur.

Risque restant : le schéma disponible ne fournit pas de rôle d’administration
ou de permission granulaire exploitable. Les mutations owner/visibilité doivent
être resserrées quand ce modèle d’autorisation sera défini.

## Données manquantes

- raison sociale et identité légale garanties ;
- score Compte calculé par un job backend ;
- snapshots historiques de score Compte déjà alimentés ;
- rôles décisionnels et relationnels confirmés ;
- parts d’échanges calculées ;
- historique d’owners et passations ;
- anciens contacts et changements d’organisation confirmés ;
- liens hiérarchiques/influence sourcés ;
- recommandations produites par un moteur backend ;
- fichiers privés et bucket mémoire ;
- prochaine réunion et tâches CRM ;
- conflits firmographiques alimentés par une source publique.

Ces valeurs restent `null`, absentes, ou « À confirmer ».

## Fonctions simulées ou incomplètes

- `/app/signals?accountId=...` et `/app/ask?accountId=...` conservent le contexte
  dans une vraie route React, mais leur écran métier complet reste à construire.
- L’organigramme P0 est une cartographie en cartes ; le graphe avancé est P1.
- Les anciens contacts, la passation, le fichier privé et l’ajout de contact
  depuis une interaction ne sont pas implémentés.
- Le score n’est pas calculé par cette livraison ; la table est prête pour le
  producteur backend.

## Périmètre P0 livré

- route `/app/accounts/:accountId` ;
- shell React Router et `Outlet` ;
- contrat typé et service agrégé ;
- hero, score, provenance, sources ;
- santé, historique réel et contrôles de couverture ;
- liste/cartographie des personnes et navigation Personne ;
- recommandations persistées ;
- signaux avec validation persistée ;
- firmographie sourcée ;
- notes mémoire persistées ;
- favori et veille persistés ;
- états chargement, introuvable, erreur, données partielles et états vides ;
- responsive et accessibilité de base ;
- migration RLS.

## Périmètre P1 recommandé

1. brancher le job canonique de score Compte ;
2. ajouter le générateur backend de recommandations ;
3. créer le modèle de permissions owner/visibilité ;
4. compléter ajout de contact et édition des rôles ;
5. créer le bucket privé et les pièces jointes ;
6. construire anciens contacts, mémoire d’owners et passations ;
7. implémenter les écrans Signaux et Ask Tohu contextualisés ;
8. créer le graphe avancé avec regroupement ;
9. brancher les fournisseurs de firmographie et leur résolution de conflits ;
10. exécuter les tests E2E sur une base de test seedée.

## Risques techniques

- Le HTML de référence manque : fidélité pixel-perfect non certifiable.
- Le projet historique reste majoritairement DOM TypeScript ; deux shells
  coexistent pendant la migration vers React.
- La base distante n’est pas liée au CLI local : migration et RLS non exécutées
  contre une instance réelle dans cette livraison.
- Le schéma initial Supabase n’est pas présent localement.
- Les centaines de contacts sont limitées à 500 côté service ; une pagination
  ou un endpoint agrégé devra remplacer cette limite pour les très gros comptes.
- Les facts firmographiques sont génériques (`value jsonb`) afin de conserver
  les contradictions ; un dictionnaire de types backend reste à formaliser.

## Vérifications exécutées

- `npm run check` : réussi.
- `npm test` : 47 tests réussis.
- `npm run build` : réussi.
- Captures desktop/mobile : non produites, car aucun navigateur automatisable
  n’est exposé dans cette session et la page exige une session Supabase réelle.
