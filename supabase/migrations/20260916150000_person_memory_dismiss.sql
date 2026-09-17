-- « Ce qu'il faut faire » (onglet Relation, fiche Personne) : écarter un
-- engagement noté dans la mémoire relationnelle (person_memory_entries) ne doit
-- jamais le supprimer physiquement — on doit pouvoir auditer et éviter qu'une
-- recommandation identique soit recréée. Même mécanique que resolved_at/resolved_by
-- (20260802160000_person_memory_resolve.sql), pour la sortie « écarté » plutôt que
-- « tenu ».

alter table public.person_memory_entries
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references auth.users(id) on delete set null;

notify pgrst, 'reload schema';
