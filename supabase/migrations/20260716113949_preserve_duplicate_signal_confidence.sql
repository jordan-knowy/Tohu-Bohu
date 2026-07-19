-- Lorsqu'une source déjà mémorisée revient avec une confiance renseignée,
-- conserve la meilleure valeur même si l'ancienne était nulle.

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
