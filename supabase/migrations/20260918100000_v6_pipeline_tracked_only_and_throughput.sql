-- Chaîne de preuve V6 : deux ruptures corrigées.
--
-- 1) identityQuality/completeness étaient câblés en dur à 'unknown' dans
--    normalizeMessage() (adapters.ts), alors que contact_id sur
--    communication_messages provient toujours de resolve_contact_identity()
--    qui refuse explicitement de deviner sur ambiguïté (jamais de LIMIT 1
--    arbitraire sur homonymes/emails partagés). Un contact_id résolu EST une
--    identité vérifiée. Corrigé côté code (adapters.ts) — cette migration ne
--    touche pas cette partie, uniquement le filtrage ci-dessous.
--
-- 2) Aucun étage du pipeline (ingestion, détection, classification) ne
--    filtrait sur contacts.is_tracked / companies.is_tracked : une personne
--    simplement présente dans la boîte mail (548 contacts dont 50 seulement
--    suivis) entrait dans le ledger et pouvait consommer du budget IA au
--    classificateur. On ajoute le filtre au point d'entrée le plus en amont
--    (ingestion) pour une garantie dure, et on le répète aux points de
--    lecture (list/find) pour ne jamais dépendre d'un seul filtre.

create or replace function public.v6_ingest_source_page(
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
  select jsonb_build_object(
    'id',m.id,'organization_id',m.organization_id,'contact_id',m.contact_id,
    'thread_id',m.thread_id,'provider',m.provider,'external_message_id',m.external_message_id,
    'direction',m.direction,'sent_at',m.sent_at,'created_at',m.created_at,
    'source_owner_user_id',m.source_owner_user_id,
    'metadata',jsonb_build_object('user_id',m.metadata->>'user_id'),
    'account_id',c.company_id
  )
  from public.communication_messages m
  join public.contacts c on c.id=m.contact_id and c.organization_id=m.organization_id
  left join public.companies co on co.id=c.company_id and co.organization_id=m.organization_id
  where (p_organization_id is null or m.organization_id=p_organization_id)
    and (p_after_created_at is null or (m.created_at,m.id) > (p_after_created_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    and (c.is_tracked is true or co.is_tracked is true)
  order by m.created_at,m.id
  limit greatest(1,least(p_limit,500));
$function$;

create or replace function public.v6_foundation_list(p_after uuid default null, p_limit integer default 100)
returns setof scoring.foundation_dyad
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'scoring'
as $function$
  select d.* from scoring.foundation_dyad d
  join public.contacts c on c.id=d.contact_id and c.organization_id=d.organization_id
  left join public.companies co on co.id=c.company_id and co.organization_id=d.organization_id
  where (p_after is null or d.id>p_after)
    and (c.is_tracked is true or co.is_tracked is true)
  order by d.id limit greatest(1,least(p_limit,100));
$function$;

create or replace function public.v6_foundation_find(
  p_after uuid default null,
  p_organization_id uuid default null,
  p_contact_id uuid default null,
  p_collaborator_id uuid default null
)
returns setof scoring.foundation_dyad
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'scoring'
as $function$
  select d.* from scoring.foundation_dyad d
  join public.contacts c on c.id=d.contact_id and c.organization_id=d.organization_id
  left join public.companies co on co.id=c.company_id and co.organization_id=d.organization_id
  where (p_after is null or d.id>p_after)
    and (p_organization_id is null or d.organization_id=p_organization_id)
    and (p_contact_id is null or d.contact_id=p_contact_id)
    and (p_collaborator_id is null or d.collaborator_user_id=p_collaborator_id)
    and (c.is_tracked is true or co.is_tracked is true)
  order by d.id limit 25;
$function$;

notify pgrst, 'reload schema';
