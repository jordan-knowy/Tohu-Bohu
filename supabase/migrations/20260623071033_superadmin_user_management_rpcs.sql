-- Super admin : gestion des UTILISATEURS (lister + super admin + plan/test)
-- Tout est SECURITY DEFINER + garde "appelant super admin" (table super_admins = source de vérité).

-- 1) Lister tous les utilisateurs (email via auth.users, org active, plan, statut super admin)
create or replace function public.admin_list_users()
returns table (
  user_id uuid, email text, full_name text, created_at timestamptz,
  org_id uuid, org_name text, plan_id text, is_super_admin boolean, meeting_count bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  return query
  select
    p.id,
    au.email::text,
    p.full_name,
    p.created_at,
    m.organization_id,
    o.name,
    coalesce(s.plan_id, 'free')::text,
    exists (select 1 from public.super_admins sx where sx.user_id = p.id),
    (select count(*) from public.meetings mt where mt.owner_user_id = p.id)
  from public.profiles p
  left join auth.users au on au.id = p.id
  left join lateral (
    select mm.organization_id from public.memberships mm
    where mm.user_id = p.id order by mm.created_at desc limit 1
  ) m on true
  left join public.organizations o on o.id = m.organization_id
  left join public.subscriptions s on s.organization_id = m.organization_id and s.status = 'active'
  order by p.created_at desc;
end;
$$;

-- 2) Basculer le statut super admin d'un utilisateur
create or replace function public.admin_set_super_admin(target_user uuid, make_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  if make_admin then
    if not exists (select 1 from public.super_admins where user_id = target_user) then
      insert into public.super_admins (user_id, email)
      values (target_user, (select email from auth.users where id = target_user));
    end if;
    update public.profiles set is_super_admin = true where id = target_user;
  else
    delete from public.super_admins where user_id = target_user;
    update public.profiles set is_super_admin = false where id = target_user;
  end if;
end;
$$;

-- 3) Définir le plan (free/pro/business/enterprise/tester/super_admin) de l'org du user
create or replace function public.admin_set_user_plan(target_user uuid, new_plan text)
returns void language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  select mm.organization_id into oid from public.memberships mm
    where mm.user_id = target_user order by mm.created_at desc limit 1;
  if oid is null then raise exception 'no organization for user'; end if;

  -- reflète aussi l'override par utilisateur (affichage page Abonnement)
  update public.profiles set subscription_override = new_plan where id = target_user;

  if exists (select 1 from public.subscriptions where organization_id = oid) then
    update public.subscriptions
      set plan_id = new_plan, status = 'active', updated_at = now()
      where organization_id = oid;
  else
    insert into public.subscriptions
      (organization_id, plan_id, status, billing_cycle, amount_per_period,
       started_at, current_period_start, current_period_end)
    values
      (oid, new_plan, 'active', 'monthly', 0, now(), now(), now() + interval '30 days');
  end if;
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_super_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_set_user_plan(uuid, text) to authenticated;
