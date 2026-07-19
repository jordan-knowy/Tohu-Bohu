-- Home Tohu — socle de données (mission Home, lot 1/2).
-- Idempotente. À appliquer sur bgmtzwfafcgjklgygvtx (MCP TB, dashboard SQL
-- ou `supabase db push` depuis le compte propriétaire).

-- 1. Digest « depuis ta dernière visite » -----------------------------------
alter table public.profiles
  add column if not exists last_home_seen_at timestamptz;

comment on column public.profiles.last_home_seen_at is
  'Dernier chargement réussi de la Home — borne du digest « depuis ta dernière visite ».';

-- 2. Comptes suivis (sélection S2/S3, périmètre du cockpit) ------------------
alter table public.companies
  add column if not exists is_tracked boolean not null default false;
alter table public.companies
  add column if not exists tracked_at timestamptz;
alter table public.companies
  add column if not exists tracked_by uuid references auth.users(id) on delete set null;

comment on column public.companies.is_tracked is
  'Compte retenu dans le portefeuille suivi (limite du forfait appliquée côté serveur).';

-- Aucun backfill automatique : un compte existant n'est pas considéré comme
-- suivi sans choix explicite de l'utilisateur. Cela évite aussi de contourner
-- le quota du forfait lors de l'ajout de la colonne.

create index if not exists companies_tracked_idx
  on public.companies(organization_id) where is_tracked;

-- 3. Limite du forfait -------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'subscription_plans'
  ) then
    execute 'alter table public.subscription_plans add column if not exists max_tracked_accounts integer';
    execute 'comment on column public.subscription_plans.max_tracked_accounts is
      ''Nombre maximal de comptes suivis (null = illimité). Source unique de la limite affichée par la Home.''';
    begin
      -- Les plans existants portent déjà leur quota dans
      -- max_profiles_per_month. On reprend cette configuration réelle au lieu
      -- d'introduire une seconde valeur arbitraire. Les valeurs négatives sont
      -- les offres illimitées et deviennent donc null.
      execute 'update public.subscription_plans
               set max_tracked_accounts = case
                 when max_profiles_per_month is null or max_profiles_per_month < 0 then null
                 else max_profiles_per_month
               end
               where max_tracked_accounts is null';
    exception when others then
      raise notice 'Initialisation max_tracked_accounts impossible: %', sqlerrm;
    end;
  end if;
end $$;

-- 4. Jobs de synchronisation : colonnes de progression + lecture org ---------
alter table public.sync_jobs add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.sync_jobs add column if not exists provider text;
alter table public.sync_jobs add column if not exists current_step text;
alter table public.sync_jobs add column if not exists progress integer default 0;
alter table public.sync_jobs add column if not exists error_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_jobs'::regclass
      and conname = 'sync_jobs_progress_check'
  ) then
    alter table public.sync_jobs
      add constraint sync_jobs_progress_check
      check (progress is null or progress between 0 and 100);
  end if;
end $$;

create index if not exists sync_jobs_home_resume_idx
  on public.sync_jobs(organization_id, user_id, started_at desc)
  where job_type in ('account_detection', 'account_analysis');

alter table public.sync_jobs enable row level security;

drop policy if exists sync_jobs_member_select on public.sync_jobs;
create policy sync_jobs_member_select on public.sync_jobs
for select to authenticated
using (private.is_org_member(organization_id));

grant select on public.sync_jobs to authenticated;

-- 5. États des actions du jour (fait / écarté / reporté) ---------------------
create table if not exists public.home_action_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id text not null,
  action_type text not null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  source_signal_id uuid,
  status text not null check (status in ('completed', 'dismissed', 'postponed')),
  reason text,
  note text,
  postponed_until timestamptz,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, action_id)
);

comment on table public.home_action_states is
  'État utilisateur des actions prioritaires de la Home. Une action écartée est conservée (signal d''apprentissage), jamais supprimée.';

create index if not exists home_action_states_org_user_idx
  on public.home_action_states(organization_id, user_id);

alter table public.home_action_states enable row level security;

drop policy if exists home_action_states_owner_all on public.home_action_states;
create policy home_action_states_owner_all on public.home_action_states
for all to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

grant select, insert, update, delete on public.home_action_states to authenticated;

create or replace function public.validate_home_action_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.companies c
    where c.id = new.company_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Le compte n''appartient pas au workspace actif';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'La personne n''appartient pas au workspace actif';
  end if;
  if new.source_signal_id is not null and not exists (
    select 1 from public.company_signals s
    where s.id = new.source_signal_id and s.organization_id = new.organization_id
    union all
    select 1 from public.behavioral_signals s
    where s.id = new.source_signal_id and s.organization_id = new.organization_id
  ) then
    raise exception 'Le signal n''appartient pas au workspace actif';
  end if;
  return new;
end;
$$;

drop trigger if exists home_action_states_validate_scope on public.home_action_states;
create trigger home_action_states_validate_scope
before insert or update on public.home_action_states
for each row execute function public.validate_home_action_scope();

-- 6. Feedback coaching (bloc coaching relationnel) ---------------------------
create table if not exists public.insight_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_id text not null,
  feedback_type text not null check (feedback_type in ('useful', 'inaccurate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, insight_id)
);

comment on table public.insight_feedback is
  'Feedback utilisateur sur les analyses coaching (« Utile » / « Pas juste »).';

create index if not exists insight_feedback_org_idx
  on public.insight_feedback(organization_id);

alter table public.insight_feedback enable row level security;

drop policy if exists insight_feedback_owner_all on public.insight_feedback;
create policy insight_feedback_owner_all on public.insight_feedback
for all to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

grant select, insert, update, delete on public.insight_feedback to authenticated;

-- 7. Horodatage updated_at uniforme -----------------------------------------
create or replace function public.touch_home_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists home_action_states_touch_updated_at on public.home_action_states;
create trigger home_action_states_touch_updated_at
before update on public.home_action_states
for each row execute function public.touch_home_updated_at();

drop trigger if exists insight_feedback_touch_updated_at on public.insight_feedback;
create trigger insight_feedback_touch_updated_at
before update on public.insight_feedback
for each row execute function public.touch_home_updated_at();

-- Un feedback de signal ne peut jamais référencer un signal d'un autre
-- workspace, même si son UUID était deviné côté client.
create or replace function public.validate_signal_feedback_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.company_signals s
    where s.id = new.signal_id and s.organization_id = new.organization_id
    union all
    select 1 from public.behavioral_signals s
    where s.id = new.signal_id and s.organization_id = new.organization_id
  ) then
    raise exception 'Le signal n''appartient pas au workspace actif';
  end if;
  return new;
end;
$$;

drop trigger if exists signal_feedback_validate_scope on public.signal_feedback;
create trigger signal_feedback_validate_scope
before insert or update on public.signal_feedback
for each row execute function public.validate_signal_feedback_scope();

notify pgrst, 'reload schema';
