-- Extensions pour planification + appels HTTP depuis Postgres
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Throttle de la veille : on ne re-scanne pas une entreprise déjà vue récemment
alter table public.companies add column if not exists last_monitored_at timestamptz;

-- Secret partagé cron↔fonction (lisible seulement par service_role grâce à RLS deny-all)
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz default now()
);
alter table public.app_secrets enable row level security;
-- aucune policy => seul le service_role (bypass RLS) peut lire/écrire

insert into public.app_secrets (name, value)
values ('monitor_cron', gen_random_uuid()::text)
on conflict (name) do nothing;
