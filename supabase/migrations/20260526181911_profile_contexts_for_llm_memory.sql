create table if not exists public.profile_contexts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  website_url text,
  website_analysis jsonb not null default '{}',
  product_description text,
  structured_offer jsonb not null default '{}',
  connected_identity_providers text[] not null default '{}',
  llm_context_summary text,
  source_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.profile_contexts enable row level security;

create policy "profile_contexts_owner_all" on public.profile_contexts
  for all using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create index if not exists profile_contexts_organization_id_idx on public.profile_contexts(organization_id);
create index if not exists profile_contexts_user_id_idx on public.profile_contexts(user_id);
