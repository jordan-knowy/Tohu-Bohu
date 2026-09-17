-- Canonical V6 contracts on an isolated rebuilt database.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000001','V6 SQL A','v6-sql-a'),('20000000-0000-0000-0000-000000000002','V6 SQL B','v6-sql-b');
insert into public.memberships(organization_id,user_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into public.companies(id,organization_id,name) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Account A'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Account B');
insert into public.contacts(id,organization_id,company_id,full_name,owner_user_id,is_tracked) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Contact A','10000000-0000-0000-0000-000000000001',true),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Contact B','10000000-0000-0000-0000-000000000002',true);

do $$ declare f record; begin
 for f in select oid,proname,prosecdef from pg_proc where pronamespace='public'::regnamespace
 and proname in ('person_brain','account_brain','v6_account_overview','v6_account_portfolio_history','v6_person_overview') loop
   perform pg_temp.assert_true(not f.prosecdef, f.proname || ' uses caller RLS');
   perform pg_temp.assert_true(not has_function_privilege('anon',f.oid,'EXECUTE'), f.proname || ' denies anon');
   perform pg_temp.assert_true(has_function_privilege('authenticated',f.oid,'EXECUTE'), f.proname || ' permits authenticated');
 end loop;
 perform pg_temp.assert_true(to_regclass('public.contact_score_history') is null,'legacy person history removed');
 perform pg_temp.assert_true(to_regclass('public.account_relationship_score_snapshots') is null,'legacy account snapshots removed');
 perform pg_temp.assert_true(to_regclass('scoring.score_snapshot') is null,'compatibility snapshots removed');
 perform pg_temp.assert_true(to_regclass('scoring.pipeline_run') is not null,'pipeline observability ledger exists');
 for f in select oid,proname,prosecdef from pg_proc where pronamespace='public'::regnamespace
 and proname in ('v6_pipeline_run_start','v6_pipeline_run_finish','v6_pipeline_health') loop
   perform pg_temp.assert_true(f.prosecdef, f.proname || ' isolates operational writes');
   perform pg_temp.assert_true(not has_function_privilege('authenticated',f.oid,'EXECUTE'), f.proname || ' denies authenticated');
   perform pg_temp.assert_true(has_function_privilege('service_role',f.oid,'EXECUTE'), f.proname || ' permits service role');
 end loop;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.v6_pipeline_run_start('score-batch-account-v6','60000000-0000-0000-0000-000000000001','{"test":true}') as pipeline_run_id \gset
select public.v6_pipeline_run_finish(:'pipeline_run_id','succeeded',12,'{"dyads_processed":1}',null,null);
select pg_temp.assert_true((public.v6_pipeline_health(24)->>'succeeded')::integer=1,'pipeline health records successful run');
insert into scoring.foundation_dyad(id,organization_id,collaborator_user_id,contact_id) values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
insert into scoring.foundation_snapshot(dyad_id,observed_at,computed_at,scoring_version,params_version,registry_version,payload) values
 ('50000000-0000-0000-0000-000000000001','2026-09-17','2026-09-17','v6-foundation-1','params-v6.0-palier','reg-v6.0',
  '{"entity":{"organizationId":"20000000-0000-0000-0000-000000000001","collaboratorUserId":"10000000-0000-0000-0000-000000000001","contactId":"40000000-0000-0000-0000-000000000001"},"status":"actif","score":73,"reliability":0.8,"axes":{"confiance":73},"admissibility":{"verdict":true},"observedAt":"2026-09-17T00:00:00Z","computedAt":"2026-09-17T00:00:00Z","scoringVersion":"v6-foundation-1","paramsVersion":"params-v6.0-palier","registryVersion":"reg-v6.0"}');
insert into scoring.account_snapshot(organization_id,account_id,observed_at,computed_at,scoring_version,params_version,registry_version,payload) values
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-17','2026-09-17','v6-account-1','params-v6.0-palier','reg-v6.0',
  '{"entity":{"organizationId":"20000000-0000-0000-0000-000000000001","accountId":"30000000-0000-0000-0000-000000000001"},"scope":"account","status":"available","score":71,"reliability":0.8,"verdictAllowed":true,"dials":{},"coverage":{"targetCount":1,"coveredCount":1},"dyads":[],"history":[],"causes":[],"observedAt":"2026-09-17T00:00:00Z","computedAt":"2026-09-17T00:00:00Z","scoringVersion":"v6-account-1","paramsVersion":"params-v6.0-palier","registryVersion":"reg-v6.0"}');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true(public.person_brain('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001')->>'score'='73','person brain reads canonical state');
select pg_temp.assert_true(public.account_brain('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')->>'score'='71','account brain reads canonical state');
select pg_temp.assert_true((select count(*) from public.v6_person_overview('20000000-0000-0000-0000-000000000001'))=1,'person overview scoped');
select pg_temp.assert_true((select count(*) from public.v6_account_overview('20000000-0000-0000-0000-000000000001'))=1,'account overview scoped');

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin perform public.account_brain('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'); raise exception 'FAIL: cross-org brain accepted';
 exception when raise_exception then if sqlerrm <> 'ACCOUNT_FORBIDDEN' then raise; end if; end;
end $$;
select pg_temp.assert_true((select count(*) from public.v6_account_overview('20000000-0000-0000-0000-000000000001'))=0,'cross-org overview empty');
reset role;
rollback;
\echo 'PASS: canonical V6 brains, overviews, RLS and legacy retirement'
