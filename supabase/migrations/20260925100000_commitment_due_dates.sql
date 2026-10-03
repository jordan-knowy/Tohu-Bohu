-- Échéances des engagements affichés dans « Ce qu'il faut faire » (fiche Compte).
--   1. Automatique : l'analyse écrit parfois « … — échéance AAAA-MM-JJ » en fin de
--      contenu ; on la lit (jamais d'échéance déduite d'un texte libre).
--   2. Manuelle : person_memory_entries.due_at, saisie directement dans l'UI ;
--      elle prime sur la date détectée.
-- account_brain est patché en place (seul le bloc 'engagements' change).

alter table public.person_memory_entries add column if not exists due_at date;

do $do$
declare
  d text;
  new_block constant text := $blk$'engagements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'origin', 'person_memory',
        'title', regexp_replace(e.content, '\s*—\s*échéance\s+\d{4}-\d{2}-\d{2}\s*$', ''),
        'detail', null,
        'status', 'active',
        'due_window_end', due.d,
        'due_source', case when e.due_at is not null then 'manual' when due.d is not null then 'detected' else null end,
        'is_overdue', case when due.d is null then null else due.d::date < current_date end,
        'resolved_at', null,
        'occurred_at', coalesce(e.source_occurred_at, e.observed_at, e.created_at),
        'evidence_count', case when e.source_excerpt is null then 0 else 1 end,
        'contact_id', e.contact_id,
        'owner_contact_id', case when e.source_direction = 'inbound' then e.contact_id else null end,
        'owner_user_id', case when e.source_direction = 'outbound' then e.author_user_id else null end,
        'evidence', case when e.source_excerpt is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
          'source_type', 'email', 'source_label', e.source_label,
          'occurred_at', coalesce(e.source_occurred_at, e.observed_at),
          'excerpt', e.source_excerpt, 'contact_id', e.contact_id)) end
      ) order by coalesce(e.source_occurred_at, e.observed_at, e.created_at) desc)
      from public.person_memory_entries e
      join public.contacts k on k.id = e.contact_id and k.organization_id = e.organization_id
      cross join lateral (select coalesce(e.due_at::text, substring(e.content from '—\s*échéance\s+(\d{4}-\d{2}-\d{2})\s*$')) as d) due
      where e.organization_id = p_organization_id
        and k.company_id = p_company_id
        and k.merged_into_contact_id is null
        and e.entry_type = 'commitment'
        and e.resolved_at is null
        and e.dismissed_at is null
        and (e.visibility = 'workspace' or e.author_user_id = p_user_id)
    ), '[]'::jsonb),
    'situation'$blk$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
  where p.proname = 'account_brain' and p.pronamespace = 'public'::regnamespace;
  if d is null or position($$'engagements', coalesce(($$ in d) = 0 then
    raise exception 'account_brain: bloc engagements introuvable';
  end if;
  d := regexp_replace(d, $re$'engagements', coalesce\(\(.*?\), '\[\]'::jsonb\),\s*'situation'$re$, replace(new_block, '\', '\\'));
  execute d;
end $do$;
