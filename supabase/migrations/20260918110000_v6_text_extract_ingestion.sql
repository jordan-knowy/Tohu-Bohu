-- Débloque la couche sémantique : classify-markers lisait event.evidenceText, mais
-- aucun événement du ledger ne le renseignait jamais (les corps d'email ne sont pas
-- stockés, par design). Le classificateur échouait donc systématiquement avant même
-- d'appeler le LLM (SOURCE_TEXT_UNAVAILABLE) — zéro coût gaspillé, mais aussi zéro
-- marqueur Confiance/Engagement produit, ce qui bloque UNOBSERVED_AXES pour 100% des
-- dyades pour toujours, quel que soit le volume d'emails.
--
-- Le code prévoyait déjà la vraie source : des extraits DÉJÀ dérivés et persistés
-- (person_key_moments.summary, person_memory_entries.source_excerpt) — jamais le
-- corps brut. Cette fonction les expose, filtrés aux entités suivies (is_tracked),
-- pour un nouveau worker d'ingestion dédié (v6-ingest-text-events).

create or replace function public.v6_ingest_text_source_page(
  p_after_created_at timestamp with time zone default null,
  p_after_id uuid default null,
  p_organization_id uuid default null,
  p_limit integer default 500
)
returns setof jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with combined as (
    select 'key_moment'::text as kind, k.id, k.organization_id, k.contact_id,
      k.summary as text, coalesce(k.occurred_at, k.created_at) as occurred_at, k.created_at
    from public.person_key_moments k
    where k.summary is not null and length(k.summary) >= 8
    union all
    select 'commitment'::text as kind, m.id, m.organization_id, m.contact_id,
      m.source_excerpt as text, coalesce(m.source_occurred_at, m.created_at) as occurred_at, m.created_at
    from public.person_memory_entries m
    where m.entry_type = 'commitment' and m.source_excerpt is not null and length(m.source_excerpt) >= 8
  )
  select jsonb_build_object(
    'kind', c.kind, 'id', c.id, 'organization_id', c.organization_id, 'contact_id', c.contact_id,
    'text', c.text, 'occurred_at', c.occurred_at, 'created_at', c.created_at,
    'owner_user_id', ct.owner_user_id
  )
  from combined c
  join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id and ct.merged_into_contact_id is null
  left join public.companies co on co.id = ct.company_id and co.organization_id = c.organization_id
  where (p_organization_id is null or c.organization_id = p_organization_id)
    and (p_after_created_at is null or (c.created_at, c.id) > (p_after_created_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and (ct.is_tracked is true or co.is_tracked is true)
    and ct.owner_user_id is not null
  order by c.created_at, c.id
  limit greatest(1, least(p_limit, 500));
$function$;

notify pgrst, 'reload schema';
