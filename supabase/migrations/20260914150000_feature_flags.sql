create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  rollout     jsonb not null default '{}'::jsonb,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select to authenticated using (true);

insert into public.feature_flags (key, enabled, rollout, description) values
  ('account_facts_engine', false, '{"mode":"off"}'::jsonb, 'Mémoire account_facts (M2) branchée en lecture'),
  ('scoring_v6_shadow',    false, '{"mode":"off"}'::jsonb, 'Écriture des marker_event + score_snapshot V6 en shadow'),
  ('scoring_v6_ui',        false, '{"mode":"off"}'::jsonb, 'Affichage de la Météo/score V6 dans l''UI'),
  ('relevance_engine_v1',  false, '{"mode":"off"}'::jsonb, 'Priorités calculées par le relevance engine v1'),
  ('account_brain_v2',     false, '{"mode":"off"}'::jsonb, 'Fiche compte servie par l''RPC account_brain')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
