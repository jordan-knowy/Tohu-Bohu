-- cognitive_mode est désormais un libellé synthétique personnalisé produit à
-- partir des preuves de la personne. L'ancienne base imposait une liste fermée
-- de modes historiques, incompatible avec ce contrat. Les dimensions
-- canoniques restent strictement contrôlées dans cognitive_profile_data.

alter table if exists public.cognitive_profiles
  drop constraint if exists cognitive_profiles_cognitive_mode_check;

alter table if exists public.cognitive_profiles
  add constraint cognitive_profiles_cognitive_mode_check
  check (
    cognitive_mode is null
    or char_length(btrim(cognitive_mode)) between 1 and 160
  );

notify pgrst, 'reload schema';
