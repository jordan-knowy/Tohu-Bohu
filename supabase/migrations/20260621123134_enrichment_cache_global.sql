-- Cache global d'enrichissement, partagé entre TOUS les users/orgs.
-- Clé = entité normalisée (person:email | company:domain). Évite de re-chercher la même donnée.
create table if not exists public.enrichment_cache (
  entity_key text primary key,
  entity_type text not null check (entity_type in ('person','company')),
  data jsonb not null,
  sources jsonb,
  refreshed_at timestamptz not null default now(),
  refresh_count integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.enrichment_cache enable row level security;
-- Lecture autorisée à tout utilisateur authentifié (données de recherche web publiques, mutualisées).
do $$ begin
  if not exists (select 1 from pg_policy where polrelid='public.enrichment_cache'::regclass and polname='enrichment_cache_read') then
    create policy enrichment_cache_read on public.enrichment_cache for select to authenticated using (true);
  end if;
end $$;
-- Écriture : service_role uniquement (edge), donc aucune policy insert/update.
create index if not exists idx_enrichment_cache_refreshed on public.enrichment_cache(refreshed_at);
