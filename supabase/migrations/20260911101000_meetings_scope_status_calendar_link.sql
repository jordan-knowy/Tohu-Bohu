-- Prépare le rattachement fiable des rendez-vous calendrier (Google/Microsoft) :
-- `meeting_scope` distingue une réunion individuelle (1:1 ou petit meeting
-- externe) d'une réunion collective (standup, webinar), pour ne jamais
-- transformer une réunion d'équipe en plusieurs "prochains rendez-vous"
-- individuels ni en plusieurs briefings. `status` permet d'exclure les
-- événements annulés du bloc "Prochain rendez-vous" et du briefing 2h.
-- `meeting_url`/`calendar_html_link` alimentent les actions "Rejoindre" /
-- "Ouvrir dans l'agenda" côté fiche Personne.

alter table public.meetings
  add column if not exists meeting_scope text not null default 'individual'
    check (meeting_scope in ('individual', 'collective')),
  add column if not exists status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  add column if not exists meeting_url text,
  add column if not exists calendar_html_link text;

comment on column public.meetings.meeting_scope is
  'individual = <= seuil de participants hors soi-même (1:1 inclus) ; collective au-delà. Calculé à l''ingestion calendrier, jamais recalculé côté UI.';
comment on column public.meetings.status is
  'confirmed par défaut ; cancelled dès que le provider calendrier renvoie l''annulation. Filtré hors "prochain rendez-vous" et hors briefing 2h.';

create index if not exists meetings_org_starts_confirmed_idx
  on public.meetings (organization_id, starts_at)
  where status = 'confirmed';

notify pgrst, 'reload schema';
