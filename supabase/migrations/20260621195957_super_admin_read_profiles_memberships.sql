do $$
begin
  if not exists (select 1 from pg_policy where polrelid='public.profiles'::regclass and polname='profiles_super_admin_read') then
    create policy profiles_super_admin_read on public.profiles for select to authenticated
      using (exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.memberships'::regclass and polname='memberships_super_admin_read') then
    create policy memberships_super_admin_read on public.memberships for select to authenticated
      using (exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()));
  end if;
end $$;
