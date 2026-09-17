-- Run only on an isolated rebuilt database: psql -X -v ON_ERROR_STOP=1 -f ...
-- Real PostgreSQL roles, RLS and RPC bodies; all synthetic fixtures roll back.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end $$;

insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000001','V6 SQL A','v6-sql-a'),
 ('20000000-0000-0000-0000-000000000002','V6 SQL B','v6-sql-b');
insert into public.memberships(organization_id,user_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003');
insert into public.companies(id,organization_id,name) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Account A'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Account B');
insert into public.contacts(id,organization_id,company_id,full_name,owner_user_id,is_tracked) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Contact A','10000000-0000-0000-0000-000000000001',true),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Contact B','10000000-0000-0000-0000-000000000002',true);

do $$ declare f record; begin
 for f in select oid,proname,prosecdef from pg_proc where pronamespace='public'::regnamespace
 and proname in ('upsert_person_marker_events','upsert_dyad_weather_snapshot','upsert_account_weather_snapshot',
 'get_dyad_weather_snapshot','get_account_prev_weather_score','get_account_dyad_snapshots','account_health_monthly','account_brain') loop
   perform pg_temp.assert_true(not f.prosecdef, f.proname || ' uses caller RLS');
   perform pg_temp.assert_true(not has_function_privilege('anon',f.oid,'EXECUTE'), f.proname || ' denies anon');
   perform pg_temp.assert_true(has_function_privilege('service_role',f.oid,'EXECUTE'), f.proname || ' permits worker');
   perform pg_temp.assert_true(has_function_privilege('authenticated',f.oid,'EXECUTE') = (f.proname not like 'upsert_%'), f.proname || ' authenticated ACL');
 end loop;
end $$;

set local role service_role;
select public.upsert_dyad_weather_snapshot('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-01','2026-09-01','test','test','{}',73,0.8,true,'actif');
select public.upsert_account_weather_snapshot('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-01','2026-09-01','test','test','{}',73,null,null);
select pg_temp.assert_true(public.upsert_person_marker_events('20000000-0000-0000-0000-000000000001','[]') = 0,'empty batch');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true(public.get_dyad_weather_snapshot('40000000-0000-0000-0000-000000000001')->>'score' = '73','owner reads snapshot');
select pg_temp.assert_true(jsonb_array_length(public.get_account_dyad_snapshots('30000000-0000-0000-0000-000000000001')) = 1,'owner reads account dyads');
select pg_temp.assert_true(public.get_account_prev_weather_score('30000000-0000-0000-0000-000000000001','2026-09-01','test','test') = 73,'owner reads previous score');
select pg_temp.assert_true(public.account_brain('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')->'account'->>'name' = 'Account A','brain works under RLS');
do $$ begin
 begin
  perform public.account_brain('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003');
  raise exception 'FAIL: impersonation accepted';
 exception when raise_exception then
  if sqlerrm <> 'ACCOUNT_FORBIDDEN' then raise; end if;
 end;
end $$;

-- Same organization, private contact owned by another collaborator.
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.get_dyad_weather_snapshot('40000000-0000-0000-0000-000000000001') is null,'private contact denied');
select pg_temp.assert_true(public.get_account_dyad_snapshots('30000000-0000-0000-0000-000000000001') = '[]','private account dyads denied');
select pg_temp.assert_true(public.get_account_prev_weather_score('30000000-0000-0000-0000-000000000001','2026-09-01','test','test') is null,'private account score denied');

-- Different organization.
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(public.get_dyad_weather_snapshot('40000000-0000-0000-0000-000000000001') is null,'cross-org contact denied');
select pg_temp.assert_true(public.get_account_dyad_snapshots('30000000-0000-0000-0000-000000000001') = '[]','cross-org account dyads denied');
select pg_temp.assert_true(public.get_account_prev_weather_score('30000000-0000-0000-0000-000000000001','2026-09-01','test','test') is null,'cross-org account score denied');
select pg_temp.assert_true(public.account_health_monthly('30000000-0000-0000-0000-000000000001') = '[]','cross-org history denied');
do $$ begin
 begin
  perform public.account_brain('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: cross-org brain accepted';
 exception when raise_exception then
  if sqlerrm <> 'ACCOUNT_FORBIDDEN' then raise; end if;
 end;
 begin
  perform public.upsert_person_marker_events('20000000-0000-0000-0000-000000000001','[]');
  raise exception 'FAIL: authenticated writer accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.get_dyad_weather_snapshot('40000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: anonymous reader accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
\echo 'PASS: V6 compatibility RPCs and account_brain security'
