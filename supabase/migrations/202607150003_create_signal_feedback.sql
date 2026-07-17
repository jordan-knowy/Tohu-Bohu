create table if not exists public.signal_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signal_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  verdict text not null check (verdict in ('confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, signal_id)
);

create index if not exists signal_feedback_org_idx
  on public.signal_feedback(organization_id);

alter table public.signal_feedback enable row level security;

drop policy if exists signal_feedback_owner_all on public.signal_feedback;
create policy signal_feedback_owner_all on public.signal_feedback
for all to authenticated
using (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

grant select, insert, update, delete on public.signal_feedback to authenticated;

notify pgrst, 'reload schema';
