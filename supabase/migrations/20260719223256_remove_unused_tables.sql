-- Tables vides sans lecteur, écrivain, vue, routine ni dépendance entrante
-- dans l'application actuellement déployée. Le code historique reste
-- restaurable depuis Git avant cette migration.

drop table if exists public.brief_insights;
drop table if exists public.contact_topics;
drop table if exists public.meeting_post_summaries;
drop table if exists public.meeting_transcripts;
drop table if exists public.notes;
drop table if exists public.profile_contexts;
drop table if exists public.relationship_edges;
drop table if exists public.weekly_impact_stats;
