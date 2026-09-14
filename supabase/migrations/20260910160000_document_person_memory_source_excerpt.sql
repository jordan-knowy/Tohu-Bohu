-- Rattrapage de dérive repo/DB : ces trois colonnes existent déjà sur la base
-- live (confirmé par introspection) mais leur migration d'origine n'a jamais
-- été committée dans ce repo. `add column if not exists` les laisse intactes
-- là où elles existent déjà ; ne crée réellement que sur un environnement qui
-- ne les a pas encore (ex. instance de dev repartie de zéro).
alter table public.person_memory_entries
  add column if not exists source_excerpt text,
  add column if not exists source_occurred_at timestamptz,
  add column if not exists source_direction text;

comment on column public.person_memory_entries.source_excerpt is
  'Extrait verbatim de l''échange source (phrase exacte) dont l''engagement est tiré. NULL si le contenu n''a pas été conservé.';
comment on column public.person_memory_entries.source_occurred_at is
  'Date du message/échange source (envoi ou réception).';
comment on column public.person_memory_entries.source_direction is
  'Sens du message source : inbound (reçu) / outbound (envoyé) / null.';
