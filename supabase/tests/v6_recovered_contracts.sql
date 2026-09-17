begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select pg_temp.assert_true(pg_get_function_result('public.accept_my_organization_invitations()'::regprocedure) = 'TABLE(organization_name text, inviter_name text)','invitation consumer contract');
select pg_temp.assert_true((select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('email_preferences','email_log','email_dispatch_rules','resource_lock','access_grant') and c.relrowsecurity),'all recovered support tables protected by RLS');
select pg_temp.assert_true(to_regclass('public.fiche_shares') is null,'retired sharing table remains retired');
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','v6-contract-test@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select count(*)=0 from public.accept_my_organization_invitations()),'no invitations has empty result');
insert into public.email_preferences(user_id) values ('10000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.email_preferences),'own email preferences visible');
do $$ begin
 begin
  perform public.admin_list_organizations();
  raise exception 'FAIL: ordinary user read admin organizations';
 exception when insufficient_privilege then null; end;
 begin
  perform public.admin_get_email_dispatch_rules();
  raise exception 'FAIL: ordinary user read admin email rules';
 exception when raise_exception then if sqlerrm <> 'Accès refusé' then raise; end if; end;
 begin
  perform public.email_dispatch_allowed('10000000-0000-0000-0000-000000000001','digest');
  raise exception 'FAIL: worker-only email RPC exposed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS: recovered support contracts and access guards'
