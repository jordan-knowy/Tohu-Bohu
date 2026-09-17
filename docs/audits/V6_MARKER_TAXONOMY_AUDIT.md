# V6 — audit de taxonomie relationnelle (Phase 2)

Date : 17 septembre 2026  
Registre examiné : `reg-v6.0`  
Décision de version : **aucune modification de registre avant preuve Gold humaine**

## Méthode et règles de décision

L'audit confronte chaque entrée C/S/E/R/A/K/X à sa définition, son utilité pour une décision produit, son impact sur le calcul, sa temporalité, sa preuve minimale et ses confusions prévisibles. Une entrée n'est conservée comme marker scorant que si elle décrit une observation relationnelle distincte, datée, réfutable et attribuable. Un fait, un engagement, un rôle, un état ou une qualité de couverture reste dans son type propre.

`Conserver provisoirement` signifie que le concept reste dans `reg-v6.0` pour assurer la continuité du moteur, sans affirmation de pertinence statistique. `Reclasser proposé` exige une nouvelle version de registre, une migration explicite et une comparaison Gold avant application. Aucun poids, seuil, cap ni marker n'est modifié par ce document.

## Personne / dyade

| ID | Décision | Définition opérationnelle | Temporalité et impact | Preuve attendue | Ambiguïté / faux positif principal |
|---|---|---|---|---|---|
| C01 | Conserver provisoirement | Divulgation volontaire d'une information personnelle ou interne non nécessaire à la tâche | Occurrence datée, confiance positive | Verbatim, acteur, destinataire, contexte montrant le caractère non requis | Information déjà publique, exigée par la tâche ou transmise par erreur |
| C02 | Conserver, détecteur de baseline | Réduction volontaire et durable des destinataires en copie par rapport à la baseline de la dyade | Variation sur une fenêtre, impact faible | En-têtes complets, baseline propre à la dyade, sujets comparables | Changement d'outil, confidentialité du dossier, listes incomplètes |
| C03 | Conserver, détecteur de baseline | Diminution du hedging propre à la dyade dans des actes comparables | Tendance, confiance positive | Séquence de messages, actes de langage comparables, baseline | Style, langue, urgence ou séniorité confondus avec confiance |
| C04 | Conserver sous forte abstention | Registre volontairement plus informel que la baseline partagée | Occurrence/tendance, confiance positive | Citation et baseline linguistique/culturelle | Emoji automatique, culture d'entreprise, tutoiement imposé, ironie |
| C05 | Conserver provisoirement | Jugement personnel sur un tiers absent, confié au collaborateur | Occurrence datée, confiance positive | Verbatim, tiers absent identifié, attribution certaine | Simple fait professionnel, citation d'autrui, critique publique |
| S01 | Conserver, détecteur de changement | Retour marqué vers une formalité supérieure à la baseline après une interaction pertinente | Changement contextualisé, satisfaction négative | Séquence avant/après et événement déclencheur | Nouveau participant, sujet juridique, canal différent |
| S02 | Conserver provisoirement | Ajout d'un interlocuteur plus senior pour escalader un problème ou obtenir une réponse | Occurrence ouverte puis résolue, impact négatif | En-têtes, rôle/séniorité datés, contenu d'escalade | Copie informative, gouvernance normale, absence de hiérarchie connue |
| S03 | Conserver avec cible obligatoire | Appréciation négative explicite de la relation, du service ou d'une action attribuable | Occurrence datée, satisfaction négative | Verbatim, cible et cause séparées | Frustration envers une panne confondue avec jugement de relation |
| S04 | Conserver, déterministe | Même demande substantielle relancée au moins deux fois sans réponse admissible | Séquence ouverte, résolue à la réponse | Thread, demande canonique, dates, absence de réponse | Relances planifiées, réponses hors canal, demandes différentes |
| S05 | Conserver provisoirement | Rituel porté par l'interlocuteur annulé puis non replanifié dans la fenêtre définie | État après délai, satisfaction négative | Série calendrier, organisateur, annulation, fenêtre de replanification | Congés, événement remplacé, problème de synchronisation calendrier |
| S06 | Conserver avec intention prouvée | Contournement du collaborateur dans un flux où son intermédiation était établie | Occurrence datée, impact négatif | Participants, flux antérieur, contenu ou action montrant le contournement | Délégation normale, indisponibilité, canal direct déjà habituel |
| S07 | Conserver critique, seuil maximal | Dénonciation explicite auprès d'un tiers avec attribution et cible certaines | Ouvert/résolu ; cap critique tant qu'applicable | Verbatim exact, tiers, auteur, cible, date ; revue humaine recommandée | Plainte sur un incident, citation, menace hypothétique ; coût FP maximal |
| S08 | Conserver provisoirement | Éloge spontané, spécifique et non requis, au-delà d'une formule de politesse | Occurrence datée, satisfaction positive | Verbatim et contexte montrant spontanéité/cible | Politesse, feedback sollicité, texte automatique, flatterie instrumentale |
| E01 | Conserver provisoirement | Introduction effective à un tiers du réseau de l'interlocuteur | Occurrence datée, engagement positif | Message d'introduction et identités vérifiées | Simple mention, transfert sans consentement, tiers déjà connu |
| E02 | Conserver provisoirement | Ouverture effective d'accès à des membres utiles de l'organisation | Occurrence/séquence, engagement positif | Invitation ou mise en relation, personnes/rôles vérifiés | Liste d'organigramme publique, copie informative, accès sans suite |
| E03 | Conserver avec condition | Projection explicite au-delà de l'engagement courant, condition conservée | Occurrence datée, engagement positif conditionnel | Verbatim, horizon, condition et auteur | Hypothèse, politesse commerciale, souhait sans intention |
| E04 | Conserver provisoirement | Production volontaire d'un livrable utile qui n'était ni demandé ni contractuellement dû | Occurrence datée, engagement positif | Artefact, auteur, absence de demande/obligation | Livrable contractuel, relance oubliée, modèle automatique |
| E05 | Conserver comme mesure comportementale | Acceptation/refus de réunions sollicitées, rapporté à une baseline et au motif connu | Série, impact bipolaire faible | Statut calendrier réel, initiateur, annulations et replanifications | Acceptation automatique, assistant, conflits d'agenda, réunions futures |
| R01 | Conserver, baseline obligatoire | Asymétrie de latence de réponse par rapport au comportement propre de la dyade | Fenêtre glissante, bipolaire | Threads appariés, sens, timestamps, baseline suffisante | Week-ends, urgence, message sans réponse attendue, canaux manquants |
| R02 | Conserver avec substance requise | Part des initiations substantielles par l'interlocuteur, relances exclues | Fenêtre glissante, bipolaire | Début de thread, contenu, auteur, distinction relance/nouveau sujet | Réponses créant un nouveau sujet, automatisations, transfert |
| A01 | Conserver comme structure observée | Diversité de canaux instrumentés réellement actifs sur la fenêtre | État de fenêtre, bipolaire | Interactions passées admissibles par canal | Canal non instrumenté, réunion future/annulée, doublons de synchronisation |
| A02 | Conserver comme continuité | Présence d'interactions admissibles dans plusieurs périodes successives | Série temporelle, bipolaire | Événements passés dédupliqués, périodes complètes | Saisonnalité, relation projet courte, trous de connecteur |

## Compte

| ID | Décision | Définition opérationnelle | Temporalité et impact | Preuve attendue | Ambiguïté / faux positif principal |
|---|---|---|---|---|---|
| K01 | Conserver provisoirement | Contrat signé sans apparition du flux attendu | État ouvert, cap après 12 mois | Contrat, date d'effet, définition du flux, absence vérifiée | Contrat-cadre sans volume, flux dans un système non connecté |
| K02 | Conserver provisoirement | Créance réellement échue et non réglée | Ouvert/résolu, escalade par âge | Facture, échéance, paiements/avoirs | Litige légitime, échéancier modifié, synchronisation comptable en retard |
| K03 | Conserver provisoirement | Demande formelle adressée au compte restée sans réponse | Par demande, ouverte/résolue | Demande, destinataire, délai attendu, réponses multicanales | Information simple, absence planifiée, demande sans owner |
| K04 | Conserver comme engagement rompu/glissé | Livrable contractuel en retard par rapport à une échéance vérifiée | Ouvert/résolu ; impact dynamique | Engagement, owner, échéance, livraison | Échéance conditionnelle, avenant, livrable partiel accepté |
| K05 | Conserver provisoirement | Porteur relationnel parti sans passation ni remplacement effectif | Ouvert jusqu'à réattribution | Départ, rôle effectif antérieur, absence/presence de passation | Changement de titre, porteur secondaire déjà actif |
| K06 | Conserver critique, seuil maximal | Rétention explicite d'un livrable comme moyen de pression | Ouvert/résolu ; cap critique | Verbatim exact et livrable dû, auteur/condition/date ; revue humaine | Dépendance contractuelle légitime, suspension de sécurité, malentendu |
| K07 | Conserver, seuil à calibrer | Incident réel affectant le compte, avec état de résolution | Occurrence puis durée ouverte | Ticket/source, sévérité, ouverture et clôture | Doublons, incident sans impact client, délai convenu différent |
| K08 | Conserver comme qualité opérationnelle | Échec de contact vers une adresse devenue invalide | Occurrence, résolu à correction/réactivation | Bounce technique, adresse, date, résultat de correction | Réponse automatique temporaire, filtrage antispam |
| K09 | **Reclasser proposé : état de couverture** | Décideur connu seulement via une escalade, sans dyade directe | État courant, zéro point | Rôle de décideur et chemin d'accès prouvés | Séniorité assimilée à décision, introduction non effective |

## Hors score et qualité

| ID | Décision | Définition opérationnelle | Temporalité / effet | Preuve attendue | Ambiguïté / faux positif principal |
|---|---|---|---|---|---|
| X01 | **Reclasser proposé : qualité de données** | Existence probable d'un canal relationnel non instrumenté | Réduit la fiabilité, jamais le score | Déclaration, trace de provenance ou écart explicable | Supposition fondée uniquement sur une absence |
| X02 | **Reclasser proposé : état relationnel** | Rupture explicitement typée et datée | Force `Rompu` selon contrat, zéro point | Source explicite, auteur, cible, date, résolution éventuelle | Menace, pause temporaire, rupture d'un seul projet |
| X03 | **Reclasser proposé : fait/engagement** | Rupture d'un rituel causée par notre côté | Contexte et engagement, jamais score direct | Calendrier, organisateur, cause et replanification | Annulation mutuelle, remplacement du rituel |

## Résultats transverses

- Le registre mélange actuellement observations scorantes, états, qualité des données et contexte. `K09` et `X01–X03` doivent être représentés par leurs types canoniques dans une future version, tout en conservant une lecture compatible des événements historiques.
- Les marqueurs linguistiques ne sont pas détectables de façon fiable sur une phrase seule. C01/C03/C04/C05/S01/S03/S06/S07/S08/E03 exigent cible, attribution et contexte ; C02/R01/R02/A01/A02 exigent une baseline ou une séquence.
- S07 et K06 ont un coût de faux positif exceptionnel : preuve verbatim, identité certaine et validation humaine doivent précéder tout effet de cap tant que le Gold Dataset n'a pas établi un seuil sûr.
- Les engagements restent des objets autonomes. E03, K04 et K06 peuvent référencer un engagement, mais ne doivent pas remplacer son owner, sa condition, son échéance et son état.
- Les contradictions sont conservées comme observations distinctes. Une appréciation positive et une frustration peuvent coexister ; le classificateur ne produit pas une tonalité unique.

## Décision de version

`reg-v6.0` reste inchangé pendant la collecte. Une éventuelle `reg-v6.1` devra fournir, marker par marker, effectifs Gold, TP/FP/FN, exemples de confusion, comparaison development puis holdout, migration de compatibilité et effet attendu sur les snapshots. En l'absence de ces preuves, créer, fusionner ou supprimer maintenant transformerait une intuition en vérité de calcul.
