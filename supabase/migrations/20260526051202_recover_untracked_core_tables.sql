-- Tables présentes en production mais absentes de l'historique de migrations
-- Supabase. Ce fichier est volontairement placé juste après la création des
-- helpers RLS privés et avant toute migration qui modifie ces tables.

create extension if not exists "uuid-ossp";

alter table public.profiles
  add column if not exists is_super_admin boolean default false,
  add column if not exists subscription_override text,
  add column if not exists sync_calendar boolean not null default true,
  add column if not exists sync_email boolean not null default true,
  add column if not exists sync_enrichment boolean not null default false;

alter table public.connectors
  add column if not exists metadata jsonb default '{}'::jsonb;

alter table public.contacts
  add column if not exists enrichment_status text not null default 'pending',
  add column if not exists last_enriched_at timestamptz,
  add column if not exists web_bio text,
  add column if not exists linkedin_headline text,
  add column if not exists enrichment_error text;

alter table public.meetings
  add column if not exists description text,
  add column if not exists company text,
  add column if not exists external_calendar_url text,
  add column if not exists user_id uuid,
  add column if not exists format text default 'video',
  add column if not exists is_external boolean default true;

alter table public.meeting_participants
  add column if not exists name text,
  add column if not exists response_status text default 'needsAction';

alter table public.cognitive_profiles
  add column if not exists jtbd_data jsonb default '{}'::jsonb,
  add column if not exists interaction_modes_data jsonb default '[]'::jsonb,
  add column if not exists theory_of_mind_data jsonb default '{}'::jsonb,
  add column if not exists behavioral_analysis_data jsonb default '[]'::jsonb,
  add column if not exists executive_summary text,
  add column if not exists cognitive_mode text,
  add column if not exists cognitive_mode_confidence numeric,
  add column if not exists engagement_score integer,
  add column if not exists score_phase text,
  add column if not exists score_intensite integer,
  add column if not exists score_reciprocite integer,
  add column if not exists score_longevite integer,
  add column if not exists score_delta integer;

create table if not exists public.subscription_plans (
  id text primary key,
  name text not null,
  description text,
  price_monthly integer default 0,
  price_yearly integer default 0,
  max_licenses integer default 1,
  max_briefs_per_month integer default 5,
  max_ai_calls_per_month integer default 100,
  max_storage_gb integer default 1,
  features jsonb default '[]'::jsonb,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now(),
  entitlements jsonb not null default '{}'::jsonb,
  max_profiles_per_month integer,
  max_tracked_accounts integer
);

insert into public.subscription_plans (
  id, name, description, price_monthly, price_yearly, max_licenses,
  max_briefs_per_month, max_ai_calls_per_month, max_storage_gb,
  features, is_active, sort_order
)
values
  ('free', 'Free', 'Commencer gratuitement', 0, 0, 1, 5, 50, 1, '["5 briefs/mois","Sync calendrier","Intelligence humaine basique","Résumés basiques","Export CRM manuel"]'::jsonb, true, 1),
  ('pro', 'Pro', 'Pour les commerciaux ambitieux', 6900, 5900, 1, -1, -1, 10, '["Briefs illimités","Intelligence humaine avancée","Intelligence entreprise","Mémoire relationnelle","CRM sync","Insights historiques","Organigrammes basiques","Support prioritaire"]'::jsonb, true, 2),
  ('business', 'Business', 'Pour les équipes performantes', 8900, 7500, 100, -1, -1, 50, '["Tout Pro, plus:","Intelligence temps réel","Advisory live","Organizational mapping avancé","Revenue intelligence","Analyse risque deal","Multi-thread tracking","Analytics équipe","Automatisations IA","API access"]'::jsonb, true, 3),
  ('enterprise', 'Enterprise', 'Sur mesure pour les grandes organisations', 0, 0, -1, -1, -1, -1, '["Tout Business, plus:","SSO / SAML","Gouvernance avancée","Compliance & audit logs","IA privée dédiée","APIs illimitées","Couche mémoire dédiée","Infrastructure dédiée","Success manager dédié","SLA personnalisé"]'::jsonb, true, 4),
  ('super_admin', 'Super Admin', 'Accès test et administration globale', 0, 0, -1, -1, -1, -1, '["Accès illimité à toutes les fonctionnalités","Switch entre plans","Gestion des organisations","Accès aux logs et métriques","Mode super admin"]'::jsonb, true, 5)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  billing_cycle text default 'monthly'
    check (billing_cycle in ('monthly', 'yearly')),
  amount_per_period integer default 0,
  started_at timestamptz default now(),
  current_period_start timestamptz default now(),
  current_period_end timestamptz default (now() + interval '1 month'),
  trial_ends_at timestamptz,
  canceled_at timestamptz,
  stripe_subscription_id text,
  stripe_customer_id text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  event_type text not null,
  tokens_used integer default 0,
  model text,
  meeting_id uuid references public.meetings(id),
  contact_id uuid references public.contacts(id),
  created_at timestamptz default now()
);

create table if not exists public.contact_score_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  phase text not null check (phase in ('growth', 'stagnant', 'decline')),
  score_intensite integer,
  score_reciprocite integer,
  score_longevite integer,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (organization_id, contact_id, user_id, snapshot_date)
);

create index if not exists idx_score_history_contact
  on public.contact_score_history(contact_id, snapshot_date desc);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('brief_ready', 'meeting_soon', 'no_brief', 'contact_alert', 'deal_risk', 'sync_done', 'team_update', 'system')),
  priority text not null default 'info' check (priority in ('urgent', 'important', 'info')),
  title text not null,
  body text,
  entity_type text check (entity_type in ('meeting', 'contact', 'organization', null)),
  entity_id uuid,
  link text,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists notif_org_created
  on public.notifications(organization_id, created_at desc);
create unique index if not exists notif_unique_user_type_entity
  on public.notifications(user_id, type, entity_id) where entity_id is not null;
create index if not exists notif_user_unread
  on public.notifications(user_id, read_at) where read_at is null;

alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.contact_score_history enable row level security;
alter table public.notifications enable row level security;

create policy subscription_plans_read on public.subscription_plans
  for select to authenticated using (true);
create policy subscriptions_read_own_org on public.subscriptions
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = subscriptions.organization_id
      and m.user_id = auth.uid()
  ));
create policy ai_usage_events_insert on public.ai_usage_events
  for insert to authenticated with check (auth.uid() = user_id);
create policy ai_usage_events_read_own_org on public.ai_usage_events
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = ai_usage_events.organization_id
      and m.user_id = auth.uid()
  ));
create policy score_history_member_all on public.contact_score_history
  for all using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy notif_select on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notif_insert on public.notifications
  for insert to authenticated with check (user_id = auth.uid());
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid());
create policy notif_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.generate_user_notifications(
  p_user_id uuid,
  p_org_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_24h timestamptz := now() + interval '24 hours';
  v_48h timestamptz := now() + interval '48 hours';
  r record;
begin
  for r in
    select id, title, company, starts_at
    from public.meetings
    where organization_id = p_org_id
      and (owner_user_id = p_user_id or user_id = p_user_id)
      and starts_at between v_now and v_24h
      and (brief_status = 'to_generate' or brief_status is null)
  loop
    insert into public.notifications (
      organization_id, user_id, type, priority, title, body,
      entity_type, entity_id, link
    )
    values (
      p_org_id, p_user_id, 'meeting_soon', 'urgent',
      'Réunion dans moins de 24h sans brief',
      coalesce(r.company, r.title) || ' · ' ||
        to_char(r.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI'),
      'meeting', r.id, '/meeting/' || r.id::text
    )
    on conflict (user_id, type, entity_id)
    where entity_id is not null
    do update set updated_at = now();
  end loop;

  for r in
    select id, title, company, starts_at
    from public.meetings
    where organization_id = p_org_id
      and (owner_user_id = p_user_id or user_id = p_user_id)
      and starts_at between v_24h and v_48h
      and (brief_status = 'to_generate' or brief_status is null)
  loop
    insert into public.notifications (
      organization_id, user_id, type, priority, title, body,
      entity_type, entity_id, link
    )
    values (
      p_org_id, p_user_id, 'no_brief', 'important',
      'Brief manquant — réunion dans 48h',
      coalesce(r.company, r.title) || ' · ' ||
        to_char(r.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI'),
      'meeting', r.id, '/meeting/' || r.id::text
    )
    on conflict (user_id, type, entity_id)
    where entity_id is not null
    do update set updated_at = now();
  end loop;

  for r in
    select id, title, company, updated_at
    from public.meetings
    where organization_id = p_org_id
      and (owner_user_id = p_user_id or user_id = p_user_id)
      and brief_status = 'ready'
      and updated_at > v_now - interval '7 days'
  loop
    insert into public.notifications (
      organization_id, user_id, type, priority, title, body,
      entity_type, entity_id, link
    )
    values (
      p_org_id, p_user_id, 'brief_ready', 'info',
      'Brief prêt — ' || coalesce(r.company, r.title),
      'Votre brief de préparation pour ' || r.title || ' est disponible',
      'meeting', r.id, '/meeting/' || r.id::text
    )
    on conflict (user_id, type, entity_id)
    where entity_id is not null
    do update set updated_at = now();
  end loop;
end;
$$;

grant all on public.subscription_plans, public.subscriptions,
  public.ai_usage_events, public.contact_score_history, public.notifications
  to anon, authenticated, service_role;
