begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.organizations(id,name,slug) values ('20000000-0000-0000-0000-000000000001','Foundation SQL','foundation-sql');
insert into public.memberships(organization_id,user_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
insert into public.contacts(id,organization_id,full_name,owner_user_id) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Contact SQL','10000000-0000-0000-0000-000000000001');
do $$ declare f record; begin
 for f in select oid,proname from pg_proc where proname like 'v6_foundation_%' loop
  perform pg_temp.assert_true(not has_function_privilege('anon',f.oid,'EXECUTE'),f.proname||' anon denied');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',f.oid,'EXECUTE'),f.proname||' user denied');
  perform pg_temp.assert_true(has_function_privilege('service_role',f.oid,'EXECUTE'),f.proname||' worker allowed');
 end loop;
 perform pg_temp.assert_true(not has_function_privilege('anon','public.v6_ingest_source_page(timestamptz,uuid,uuid,integer)','EXECUTE'),'V6 ingest source denies anon');
 perform pg_temp.assert_true(not has_function_privilege('authenticated','public.v6_ingest_source_page(timestamptz,uuid,uuid,integer)','EXECUTE'),'V6 ingest source denies users');
 perform pg_temp.assert_true(has_function_privilege('service_role','public.v6_ingest_source_page(timestamptz,uuid,uuid,integer)','EXECUTE'),'V6 ingest source permits service role');
end $$;
set local role service_role;
do $$
declare
 dyad jsonb := '{"organizationId":"20000000-0000-0000-0000-000000000001","collaboratorUserId":"10000000-0000-0000-0000-000000000001","contactId":"40000000-0000-0000-0000-000000000001"}';
 payload jsonb; snapshot jsonb; d uuid; d2 uuid;
begin
 payload := jsonb_build_object('id','event-1','recordedAt','2026-09-01T00:00:00Z','effectiveFrom','2026-09-01T00:00:00Z','dyad',dyad,'state','observed');
 d := public.v6_foundation_append(dyad,'event',payload);
 perform pg_temp.assert_true(public.v6_foundation_append(dyad,'event',payload)=d,'append retry same dyad');
 perform pg_temp.assert_true((select count(*)=1 from scoring.foundation_revision where dyad_id=d),'append retry no duplicate');
 begin
  perform public.v6_foundation_append(dyad,'event',payload||'{"state":"cancelled"}');
  raise exception 'FAIL: conflicting revision accepted';
 exception when raise_exception then if sqlerrm <> 'IMMUTABLE_REVISION_CONFLICT' then raise; end if; end;
 begin
  perform public.v6_foundation_append(dyad,'event',payload||'{"dyad":{}}');
  raise exception 'FAIL: mismatched dyad accepted';
 exception when raise_exception then if sqlerrm <> 'DYAD_MISMATCH' then raise; end if; end;
 begin
  perform public.v6_foundation_append(dyad,'marker',payload||'{"markerId":"UNKNOWN","registryVersion":"reg-v6.0"}');
  raise exception 'FAIL: unknown marker accepted';
 exception when raise_exception then if sqlerrm <> 'UNKNOWN_MARKER' then raise; end if; end;
 begin
  perform public.v6_foundation_append(dyad||'{"organizationId":"20000000-0000-0000-0000-000000000099"}','event',payload);
  raise exception 'FAIL: invalid organization accepted';
 exception when raise_exception then if sqlerrm <> 'INVALID_DYAD' then raise; end if; end;
 snapshot := jsonb_build_object('entity',dyad,'scoringVersion','v6-foundation-1','paramsVersion','test','registryVersion','reg-v6.0','observedAt','2026-09-01T00:00:00Z','computedAt','2026-09-01T00:00:00Z','score',null);
 perform public.v6_foundation_store(d,'snapshot',snapshot);
 perform public.v6_foundation_store(d,'snapshot',snapshot);
 perform pg_temp.assert_true((select count(*)=1 from scoring.foundation_snapshot where dyad_id=d),'snapshot retry no duplicate');
 begin
  perform public.v6_foundation_store(d,'snapshot',snapshot||'{"score":50}');
  raise exception 'FAIL: conflicting snapshot silently accepted';
 exception when raise_exception then if sqlerrm <> 'IMMUTABLE_SNAPSHOT_CONFLICT' then raise; end if; end;
 dyad := dyad||'{"collaboratorUserId":"10000000-0000-0000-0000-000000000002"}';
 d2 := public.v6_foundation_append(dyad,'event',payload||jsonb_build_object('dyad',dyad));
 perform pg_temp.assert_true(d2<>d,'two collaborators have distinct dyads');
 perform pg_temp.assert_true(jsonb_array_length(public.v6_foundation_read(d2)->'events')=1,'separate ledger');
 begin
  perform public.v6_foundation_store(d2,'snapshot',snapshot);
  raise exception 'FAIL: snapshot accepted for another collaborator';
 exception when raise_exception then if sqlerrm <> 'SNAPSHOT_DYAD_MISMATCH' then raise; end if; end;
end $$;
reset role;
rollback;
\echo 'PASS: foundation identity, ACL, idempotency and immutable conflicts'
