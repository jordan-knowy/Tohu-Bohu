-- La v1 du moteur écrivait par erreur la longévité dans recency_score.
-- Les nouveaux snapshots conservent désormais les deux dimensions séparément.
alter table public.person_relationship_score_snapshots
  add column if not exists longevity_score numeric
    check (longevity_score between 0 and 100);

comment on column public.person_relationship_score_snapshots.longevity_score is
  'Ancienneté et constance de la relation, de 0 à 100.';

comment on column public.person_relationship_score_snapshots.recency_score is
  'Fraîcheur du dernier échange, de 0 à 100.';
