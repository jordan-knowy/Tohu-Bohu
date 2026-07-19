create table if not exists public.nps_snapshots (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_date date not null default current_date,
  nps_value integer,
  avg_score integer,
  promoters integer,
  detractors integer,
  total integer,
  created_at timestamptz not null default now(),
  unique (organization_id, snapshot_date)
);
alter table public.nps_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid='public.nps_snapshots'::regclass and polname='nps_snapshots_member_select') then
    create policy nps_snapshots_member_select on public.nps_snapshots for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.nps_snapshots'::regclass and polname='nps_snapshots_member_insert') then
    create policy nps_snapshots_member_insert on public.nps_snapshots for insert to authenticated with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.nps_snapshots'::regclass and polname='nps_snapshots_member_update') then
    create policy nps_snapshots_member_update on public.nps_snapshots for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
  end if;
end $$;
