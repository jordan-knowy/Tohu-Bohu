-- Exercise the deployed policy against the official managed Storage schema.
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000001','Storage A','storage-a'),('20000000-0000-0000-0000-000000000002','Storage B','storage-b');
insert into public.memberships(organization_id,user_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into storage.buckets(id,name) values ('tohu-documents','tohu-documents') on conflict(id) do nothing;
insert into storage.objects(bucket_id,name) values
 ('tohu-documents','20000000-0000-0000-0000-000000000001/transcripts/test-a.txt'),
 ('tohu-documents','20000000-0000-0000-0000-000000000002/transcripts/test-b.txt');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.assert_true((select count(*)=1 from storage.objects where bucket_id='tohu-documents'),'only own organization documents visible');
insert into storage.objects(bucket_id,name) values ('tohu-documents','20000000-0000-0000-0000-000000000001/transcripts/upload.txt');
do $$ begin
 begin
  insert into storage.objects(bucket_id,name) values ('tohu-documents','20000000-0000-0000-0000-000000000002/transcripts/attack.txt');
  raise exception 'FAIL: cross-org upload accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into storage.objects(bucket_id,name) values ('tohu-documents','not-a-uuid/transcripts/attack.txt');
  raise exception 'FAIL: malformed org accepted';
 exception when insufficient_privilege then null; end;
 begin
  update storage.objects set name='20000000-0000-0000-0000-000000000002/transcripts/moved.txt'
  where name='20000000-0000-0000-0000-000000000001/transcripts/upload.txt';
  raise exception 'FAIL: cross-org move accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='tohu-documents'),'anonymous documents denied');
reset role;
rollback;
\echo 'PASS: Storage tenant isolation, upload and move'
