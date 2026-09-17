begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001');
-- A stale/corrupt display flag must not grant administrator authority.
insert into public.profiles(id,full_name,is_super_admin,platform_role)
values ('10000000-0000-0000-0000-000000000001','SQL user',true,'super_admin')
on conflict(id) do update set is_super_admin=true,platform_role='super_admin';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true(not public.is_super_admin_caller(),'display flags cannot grant admin authority');
update public.profiles set full_name='Updated SQL user' where id=auth.uid();
select pg_temp.assert_true((select full_name='Updated SQL user' from public.profiles where id=auth.uid()),'ordinary profile edits preserved');
do $$ begin
 begin
  update public.profiles set is_super_admin=true where id=auth.uid();
  raise exception 'FAIL: self promotion accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.profiles set platform_role='super_admin' where id=auth.uid();
  raise exception 'FAIL: platform role self promotion accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.admin_delete_user('10000000-0000-0000-0000-000000000002');
  raise exception 'FAIL: display admin called destructive admin RPC';
 exception when raise_exception then if sqlerrm <> 'forbidden' then raise; end if; end;
 begin
  perform public.promote_account_facts('20000000-0000-0000-0000-000000000001',null);
  raise exception 'FAIL: maintenance exposed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')),'no anonymous definer API');
rollback;
\echo 'PASS: profile privilege escalation and privileged maintenance boundaries'
