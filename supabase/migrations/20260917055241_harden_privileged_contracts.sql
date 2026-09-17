-- Administrator authority comes from the protected super_admins table, never
-- from mutable presentation fields on the caller's profile.
create or replace function public.is_super_admin_caller()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_super_admin();
$$;
revoke insert,update on public.profiles from public,anon,authenticated;
revoke insert(is_super_admin,platform_role),update(is_super_admin,platform_role) on public.profiles from public,anon,authenticated;
do $$ declare columns text; begin
  select string_agg(format('%I',attname),',' order by attnum) into columns
  from pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
    and attname not in ('is_super_admin','platform_role');
  execute format('grant insert(%s),update(%s) on public.profiles to authenticated',columns,columns);
end $$;

-- Existing workers are the only callers of these maintenance routines.
revoke all on function public.promote_account_facts(uuid,uuid), public.reconcile_account_facts(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.promote_account_facts(uuid,uuid), public.reconcile_account_facts(uuid,uuid)
  to service_role;

-- No public-schema SECURITY DEFINER routine is an anonymous API contract.
-- Preserve signed-in access where it existed; trigger routines need no direct
-- EXECUTE grant. Also close the retired sharing RPCs if still deployed.
-- Resolve from the catalogue so retired functions stay retired.
do $$ declare f record; begin
 for f in select p.oid, p.oid::regprocedure signature, (p.prorettype='trigger'::regtype or p.proname in ('share_fiche','list_fiche_shares','revoke_fiche_share')) internal_only,
   has_function_privilege('authenticated',p.oid,'execute') had_authenticated
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
 loop
   if f.had_authenticated and not f.internal_only then
     execute format('grant execute on function %s to authenticated',f.signature);
   end if;
   execute format('revoke all on function %s from public,anon',f.signature);
   if f.internal_only then execute format('revoke all on function %s from authenticated',f.signature); end if;
 end loop;
end $$;
alter function public.format_person_full_name(text) set search_path = pg_catalog,public;
alter function public.normalize_contact_full_name() set search_path = pg_catalog,public;
