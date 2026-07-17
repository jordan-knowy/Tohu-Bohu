revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_set_super_admin(uuid, boolean) from public, anon;
revoke execute on function public.admin_set_user_plan(uuid, text) from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.set_org_logo(uuid, text) from public, anon;

revoke execute on function public.generate_user_notifications(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.generate_user_notifications(uuid, uuid)
  to service_role;

alter function public.generate_user_notifications(uuid, uuid)
  set search_path = public, private, pg_temp;
