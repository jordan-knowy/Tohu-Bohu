-- Existing versioned RPCs only. The seven unknown RPCs are deliberately untouched.
create or replace function public.get_person_marker_events(p_contact_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,scoring,private as $$
declare org uuid;
begin
  select organization_id into org from public.contacts where id=p_contact_id;
  if org is null or (auth.role() is distinct from 'service_role' and
      (auth.uid() is null or not private.can_view_contact(org,p_contact_id))) then raise exception 'CONTACT_FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('marker_id',marker_id,'sense',sense,'observed_at',observed_at,
    'evidence_ref',evidence_ref,'evidence_text',evidence_text,'is_verbatim',is_verbatim) order by observed_at desc,id),'[]'::jsonb)
    from scoring.marker_event where scope='person' and contact_id=p_contact_id and organization_id=org
      and not is_candidate and deprecated_at is null and resolved_at is null);
end $$;
create or replace function public.get_account_k_marker_events(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,scoring,private as $$
declare org uuid;
begin
  select organization_id into org from public.companies where id=p_company_id;
  if org is null or (auth.role() is distinct from 'service_role' and
      (auth.uid() is null or not private.can_view_company(org,p_company_id))) then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('marker_id',marker_id,'observed_at',observed_at,
    'evidence_ref',evidence_ref,'evidence_text',evidence_text,'is_verbatim',is_verbatim) order by observed_at,id),'[]'::jsonb)
    from scoring.marker_event where scope='account' and account_id=p_company_id and organization_id=org
      and not is_candidate and deprecated_at is null and resolved_at is null);
end $$;
revoke all on function public.get_person_marker_events(uuid),public.get_account_k_marker_events(uuid) from public,anon;
grant execute on function public.get_person_marker_events(uuid),public.get_account_k_marker_events(uuid) to authenticated,service_role;
