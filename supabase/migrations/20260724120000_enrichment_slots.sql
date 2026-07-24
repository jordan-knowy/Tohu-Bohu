-- Sémaphore global de concurrence pour l'agent d'enrichissement (remplace le webhook
-- n8n : voir supabase/functions/_shared/enrichment-agent.ts). Un cap LOCAL par
-- invocation (N8N_CONCURRENCY=5 dans monitor-contacts) ne protège pas contre plusieurs
-- invocations simultanées (cron + "Actualiser" manuel côté compte/personne) : c'est ce
-- qui a fait crasher l'instance n8n le 2026-07-22 (~10 exécutions concurrentes malgré
-- le cap local à 5). Un pool de créneaux partagé en base, acquis via FOR UPDATE SKIP
-- LOCKED, borne le nombre RÉEL d'appels IA simultanés, tous déclencheurs confondus.

create table if not exists public.enrichment_slots (
  id smallint primary key,
  locked_at timestamptz
);

insert into public.enrichment_slots (id)
select generate_series(1, 5)
on conflict (id) do nothing;

alter table public.enrichment_slots enable row level security;
revoke all on public.enrichment_slots from public, anon, authenticated;

-- Créneau considéré libre après 5 min sans libération explicite : filet de sécurité
-- si une Edge Function crashe/timeout sans passer par le `finally` qui le libère.
create or replace function public.acquire_enrichment_slot()
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id smallint;
begin
  select id into v_id
  from public.enrichment_slots
  where locked_at is null or locked_at < now() - interval '5 minutes'
  order by id
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.enrichment_slots set locked_at = now() where id = v_id;
  return v_id;
end;
$$;

create or replace function public.release_enrichment_slot(p_id smallint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.enrichment_slots set locked_at = null where id = p_id;
$$;

revoke all on function public.acquire_enrichment_slot() from public, anon, authenticated;
revoke all on function public.release_enrichment_slot(smallint) from public, anon, authenticated;
grant execute on function public.acquire_enrichment_slot() to service_role;
grant execute on function public.release_enrichment_slot(smallint) to service_role;
