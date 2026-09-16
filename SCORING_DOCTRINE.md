# SCORING_DOCTRINE — Tohu

> Doctrine centrale du scoring. Toute PR touchant au scoring, aux marqueurs, à
> la pertinence ou à la mémoire doit s'y conformer. Version d'origine : 2026-09-14.

## Scoring relationnel (Météo compte + score dyade)

1. **Pas de règle écrite → pas de point.** Un marqueur n'existe que s'il figure
   dans `marker_registry` avec une définition écrite.
2. **Pas de `marker_event` → pas de point.** Le `marker_event` est la **seule**
   porte d'entrée du scoring relationnel.
3. **Pas de date (`observed_at`) → pas de point.**
4. **Pas de preuve (`evidence_ref`/`evidence_text`) → pas de point.**
5. **Absence de données → fiabilité, jamais score inventé.** Un axe observé sans
   marqueur = base 50. Un axe hors fenêtre / sous les seuils = `null`. **Jamais
   50 par défaut** pour combler une absence de mesure.
6. **LLM = extraction / classification uniquement.** Le LLM peut répondre
   « cet extrait correspond-il à S03 ? » et renvoyer `marker_id` + `evidence` +
   `observed_at`, en choisissant dans un **registre fermé** (ou `NO_MARKER`).
   Il ne décide **jamais** un nombre d'axe (« Satisfaction = 31 » interdit) ni
   n'invente un marqueur hors registre.
7. **Calcul = déterministe et versionné.** Même `marker_events` + même
   `params_version` + même `registry_version` + même `at` → même score. Une
   version de paramètres publiée est immuable ; tout changement = nouvelle
   version. Un marqueur n'est jamais supprimé (déprécié avec date), les ids ne
   sont jamais recyclés.
8. **Le revenu n'entre jamais** dans le score relationnel.
9. **L'unité est la dyade** (X ↔ collaborateur), jamais une note individuelle
   agrégée.
10. **Paramètre provisoire = affiché comme provisoire.** La Météo est une lecture
    structurée des signaux, **pas** une probabilité prédictive validée. Interdits
    UI : « 82 % de churn », « probabilité de signature 74 % », « prédiction de
    départ ».
11. **Legacy ≠ V6.** On ne convertit jamais un ancien score en faux
    `marker_events`. V6 repart des preuves brutes.

## Pertinence (priorité / signaux / recommandations)

12. **Moteur séparé.** La priorité ne mesure jamais la santé relationnelle ;
    la Météo ne mesure jamais l'urgence opérationnelle.
13. **Priorité ≠ gravité.** Une info très négative peut être peu actionnable ;
    une info neutre peut être très urgente.
14. **Un signal est un changement**, pas un état permanent. « Un seul porteur »
    est un état structurel (cadran Équilibre), pas un « signal récent » quotidien.
15. **Échelle commune 0–100.** Pas de moyenne entre échelles hétérogènes
    (`50+delta`, `40+jours/5`, `concentration %`, fixes). Décomposition en
    impact · urgence · nouveauté · fiabilité · actionnabilité · lien-objectif,
    chacune normalisée 0→1 puis convertie 0→100. Poids **non figés** tant que
    non validés avec tests de sensibilité.

## Mémoire

16. `account_fact` **≠** `marker_event`. Un fait de mémoire ne produit un
    marqueur que si la définition précise du registre est **entièrement**
    satisfaite (dû, contractuel, échéance dépassée, preuve… pour K04).
17. `marker_event` **≠** `recommendation`.
18. `recommendation` **≠** `fact`.
