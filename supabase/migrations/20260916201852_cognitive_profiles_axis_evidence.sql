-- Persiste les preuves datées/concrètes générées par l'analyse comportementale
-- (behavior-analysis.ts, champs trust.evidence / satisfaction.evidence) — jusqu'ici
-- calculées par le LLM à chaque run mais jamais sauvegardées (seul `observation`,
-- un texte général, était persisté dans trust_reasoning/satisfaction_reasoning).
-- Sans ces preuves, l'UI ne peut afficher qu'une description méthodologique
-- générique au lieu des faits réels ayant produit le score (ex. "a confirmé le
-- 12/06 un délai non tenu au 20/06"). Additif, non-breaking, ne change aucun
-- calcul de score existant.
alter table public.cognitive_profiles
  add column if not exists trust_evidence jsonb,
  add column if not exists satisfaction_evidence jsonb;

comment on column public.cognitive_profiles.trust_evidence is
  'Tableau de 1 à 3 faits datés concrets (texte libre du LLM) ayant motivé trust_score — voir behavior-analysis.ts champ trust.evidence. Jamais fabriqué : absent/null tant qu''aucune preuve concrète n''a été identifiée.';
comment on column public.cognitive_profiles.satisfaction_evidence is
  'Tableau de 1 à 3 faits datés concrets (texte libre du LLM) ayant motivé satisfaction_score — voir behavior-analysis.ts champ satisfaction.evidence. Jamais fabriqué : absent/null tant qu''aucune preuve concrète n''a été identifiée.';
