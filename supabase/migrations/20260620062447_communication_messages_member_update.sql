do $$
begin
  if not exists (
    select 1 from pg_policy where polrelid='public.communication_messages'::regclass
      and polname='communication_messages_member_update'
  ) then
    create policy communication_messages_member_update
      on public.communication_messages
      for update
      using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;
end $$;
