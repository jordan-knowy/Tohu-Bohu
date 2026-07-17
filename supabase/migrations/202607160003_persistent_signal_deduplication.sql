-- Mémoire anti-doublon persistante pour les signaux de comptes et personnes.
-- Une même source peut reformuler son titre à chaque collecte : pour les
-- comptes, l'URL canonique est donc prioritaire. Pour les personnes, le type
-- et le contenu normalisé constituent l'identité du signal.

create or replace function public.normalize_signal_content(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g'))
$$;

create or replace function public.company_signal_deduplication_key(
  p_family text,
  p_title text,
  p_source_url text
)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(concat_ws(
    '|',
    public.normalize_signal_content(p_family),
    coalesce(
      nullif(regexp_replace(lower(btrim(coalesce(p_source_url, ''))), '[?#].*$', ''), ''),
      public.normalize_signal_content(p_title)
    )
  ))
$$;

create or replace function public.behavioral_signal_deduplication_key(
  p_signal_type text,
  p_text text
)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(concat_ws(
    '|',
    public.normalize_signal_content(p_signal_type),
    public.normalize_signal_content(p_text)
  ))
$$;

alter table public.company_signals
  add column if not exists deduplication_key text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists duplicate_count integer;

alter table public.behavioral_signals
  add column if not exists deduplication_key text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists duplicate_count integer;

update public.company_signals
set deduplication_key = public.company_signal_deduplication_key(family, title, source_url),
    first_seen_at = coalesce(first_seen_at, observed_at, created_at),
    last_seen_at = coalesce(last_seen_at, observed_at, created_at),
    duplicate_count = coalesce(duplicate_count, 0);

update public.behavioral_signals
set deduplication_key = public.behavioral_signal_deduplication_key(signal_type, text),
    first_seen_at = coalesce(first_seen_at, observed_at, created_at),
    last_seen_at = coalesce(last_seen_at, observed_at, created_at),
    duplicate_count = coalesce(duplicate_count, 0);

create temporary table signal_dedup_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

insert into signal_dedup_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    id,
    first_value(id) over (
      partition by organization_id,
        coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        deduplication_key
      order by first_seen_at, created_at, id
    ) as keeper_id,
    row_number() over (
      partition by organization_id,
        coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        deduplication_key
      order by first_seen_at, created_at, id
    ) as duplicate_rank
  from public.company_signals
) ranked
where duplicate_rank > 1;

insert into signal_dedup_map (duplicate_id, keeper_id)
select id, keeper_id
from (
  select
    id,
    first_value(id) over (
      partition by organization_id, contact_id, deduplication_key
      order by first_seen_at, created_at, id
    ) as keeper_id,
    row_number() over (
      partition by organization_id, contact_id, deduplication_key
      order by first_seen_at, created_at, id
    ) as duplicate_rank
  from public.behavioral_signals
) ranked
where duplicate_rank > 1;

-- Conserve les validations humaines en les rattachant au signal mémorisé.
insert into public.signal_feedback (
  organization_id,
  signal_id,
  user_id,
  verdict,
  created_at,
  updated_at
)
select
  feedback.organization_id,
  mapping.keeper_id,
  feedback.user_id,
  feedback.verdict,
  feedback.created_at,
  feedback.updated_at
from public.signal_feedback feedback
join signal_dedup_map mapping on mapping.duplicate_id = feedback.signal_id
on conflict (user_id, signal_id) do update
set verdict = case
      when excluded.updated_at >= signal_feedback.updated_at then excluded.verdict
      else signal_feedback.verdict
    end,
    updated_at = greatest(signal_feedback.updated_at, excluded.updated_at);

delete from public.signal_feedback feedback
using signal_dedup_map mapping
where feedback.signal_id = mapping.duplicate_id;

update public.home_action_states action
set source_signal_id = mapping.keeper_id
from signal_dedup_map mapping
where action.source_signal_id = mapping.duplicate_id;

with aggregate as (
  select
    mapping.keeper_id,
    count(*)::integer as duplicate_count,
    max(signal.last_seen_at) as last_seen_at
  from signal_dedup_map mapping
  join public.company_signals signal on signal.id = mapping.duplicate_id
  group by mapping.keeper_id
)
update public.company_signals keeper
set duplicate_count = keeper.duplicate_count + aggregate.duplicate_count,
    last_seen_at = greatest(keeper.last_seen_at, aggregate.last_seen_at)
from aggregate
where keeper.id = aggregate.keeper_id;

with aggregate as (
  select
    mapping.keeper_id,
    count(*)::integer as duplicate_count,
    max(signal.last_seen_at) as last_seen_at
  from signal_dedup_map mapping
  join public.behavioral_signals signal on signal.id = mapping.duplicate_id
  group by mapping.keeper_id
)
update public.behavioral_signals keeper
set duplicate_count = keeper.duplicate_count + aggregate.duplicate_count,
    last_seen_at = greatest(keeper.last_seen_at, aggregate.last_seen_at)
from aggregate
where keeper.id = aggregate.keeper_id;

delete from public.company_signals signal
using signal_dedup_map mapping
where signal.id = mapping.duplicate_id;

delete from public.behavioral_signals signal
using signal_dedup_map mapping
where signal.id = mapping.duplicate_id;

alter table public.company_signals
  alter column deduplication_key set not null,
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column duplicate_count set default 0,
  alter column duplicate_count set not null;

alter table public.behavioral_signals
  alter column deduplication_key set not null,
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column duplicate_count set default 0,
  alter column duplicate_count set not null;

alter table public.company_signals
  drop constraint if exists company_signals_duplicate_count_check;
alter table public.company_signals
  add constraint company_signals_duplicate_count_check check (duplicate_count >= 0);

alter table public.behavioral_signals
  drop constraint if exists behavioral_signals_duplicate_count_check;
alter table public.behavioral_signals
  add constraint behavioral_signals_duplicate_count_check check (duplicate_count >= 0);

create unique index if not exists company_signals_deduplication_uidx
on public.company_signals (
  organization_id,
  coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
  deduplication_key
);

create unique index if not exists behavioral_signals_deduplication_uidx
on public.behavioral_signals (organization_id, contact_id, deduplication_key);

create or replace function public.remember_company_signal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_id uuid;
  seen_at timestamptz;
begin
  new.deduplication_key := public.company_signal_deduplication_key(
    new.family,
    new.title,
    new.source_url
  );
  seen_at := coalesce(new.observed_at, new.created_at, now());

  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || '|' ||
    coalesce(new.company_id::text, 'global') || '|' ||
    new.deduplication_key,
    0
  ));

  select id into existing_id
  from public.company_signals
  where organization_id = new.organization_id
    and company_id is not distinct from new.company_id
    and deduplication_key = new.deduplication_key
  limit 1;

  if existing_id is not null then
    update public.company_signals
    set last_seen_at = greatest(last_seen_at, seen_at),
        duplicate_count = duplicate_count + 1,
        confidence = coalesce(greatest(confidence, new.confidence), confidence, new.confidence),
        updated_at = now()
    where id = existing_id;
    return null;
  end if;

  new.first_seen_at := coalesce(new.first_seen_at, seen_at);
  new.last_seen_at := coalesce(new.last_seen_at, seen_at);
  new.duplicate_count := coalesce(new.duplicate_count, 0);
  return new;
end;
$$;

create or replace function public.remember_behavioral_signal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_id uuid;
  seen_at timestamptz;
begin
  new.deduplication_key := public.behavioral_signal_deduplication_key(
    new.signal_type,
    new.text
  );
  seen_at := coalesce(new.observed_at, new.created_at, now());

  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || '|' ||
    new.contact_id::text || '|' ||
    new.deduplication_key,
    0
  ));

  select id into existing_id
  from public.behavioral_signals
  where organization_id = new.organization_id
    and contact_id = new.contact_id
    and deduplication_key = new.deduplication_key
  limit 1;

  if existing_id is not null then
    update public.behavioral_signals
    set last_seen_at = greatest(last_seen_at, seen_at),
        duplicate_count = duplicate_count + 1,
        confidence = greatest(confidence, new.confidence)
    where id = existing_id;
    return null;
  end if;

  new.first_seen_at := coalesce(new.first_seen_at, seen_at);
  new.last_seen_at := coalesce(new.last_seen_at, seen_at);
  new.duplicate_count := coalesce(new.duplicate_count, 0);
  return new;
end;
$$;

drop trigger if exists remember_company_signal on public.company_signals;
create trigger remember_company_signal
before insert on public.company_signals
for each row execute function public.remember_company_signal();

drop trigger if exists remember_behavioral_signal on public.behavioral_signals;
create trigger remember_behavioral_signal
before insert on public.behavioral_signals
for each row execute function public.remember_behavioral_signal();
