-- V57 : le référentiel comportemental passe de 16 dimensions (interpersonal +
-- exchange_styles + speech_acts + observable_markers) à un modèle bipolaire à
-- 6 axes primaires (Rythme/Argumentation/Engagement/Registre/Tonalité/Espace
-- de parole) + 4 axes secondaires (Orientation/Certitude/Nouveauté/Initiative).
-- interpersonal (assertiveness/warmth) et posture sont conservés : ils
-- alimentent le cadran interpersonnel et la synthèse.
--
-- cognitive_profile_data reste jsonb (schéma applicatif, pas relationnel) :
-- cette migration documente le contrat et ajoute un index de suivi de
-- migration, pas une contrainte de forme. Les profils schema_version<=2
-- restent lisibles (dégradation gracieuse côté front, voir mapping.ts).

comment on column public.cognitive_profiles.cognitive_profile_data is
  'v3 (voir sync-email-analysis/index.ts analyze()) : { schema_version:3,'
  ' primary_axes: {rythme,argumentation,engagement,registre,tonalite,espace_parole},'
  ' secondary_axes: {orientation,certainty,novelty,initiative},'
  ' interpersonal: {assertiveness,warmth}, posture }.'
  ' v2 (schema_version<=2) conserve exchange_styles/speech_acts/'
  ' observable_markers, en lecture seule.';

create index if not exists cognitive_profiles_axis_schema_idx
  on public.cognitive_profiles ((((cognitive_profile_data->>'schema_version'))::int));

notify pgrst, 'reload schema';
