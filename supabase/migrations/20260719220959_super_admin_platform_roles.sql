-- Rôle plateforme Super Admin, distinct des plans commerciaux.
-- La liste privée permet de préparer un accès avant même la création du compte Auth.

create table if not exists private.super_admin_email_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

revoke all on table private.super_admin_email_allowlist from public, anon, authenticated;

insert into private.super_admin_email_allowlist (email)
values
  ('contact@webfityou.com'),
  ('peravjojo@hotmail.com'),
  ('jordan@knowr.co'),
  ('maxime@knowr.co'),
  ('maxime@optee.io')
on conflict (email) do nothing;

alter table public.profiles
  add column if not exists platform_role text not null default 'user'
  check (platform_role in ('user', 'super_admin'));

-- Réconcilie les administrateurs historiques avec le rôle plateforme canonique.
update public.profiles p
set
  platform_role = 'super_admin',
  is_super_admin = true,
  updated_at = now()
where exists (
  select 1
  from public.super_admins sa
  where sa.user_id = p.id
);

-- Active immédiatement les comptes demandés qui existent déjà.
insert into public.super_admins (user_id, email)
select u.id, lower(u.email)
from auth.users u
join private.super_admin_email_allowlist a on a.email = lower(u.email)
on conflict (user_id) do update set email = excluded.email;

update public.profiles p
set
  platform_role = 'super_admin',
  is_super_admin = true,
  updated_at = now()
from auth.users u
join private.super_admin_email_allowlist a on a.email = lower(u.email)
where p.id = u.id;

create or replace function public.admin_set_super_admin(target_user uuid, make_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  if make_admin then
    insert into public.super_admins (user_id, email)
    select u.id, lower(u.email)
    from auth.users u
    where u.id = target_user
    on conflict (user_id) do update set email = excluded.email;

    update public.profiles
    set platform_role = 'super_admin', is_super_admin = true, updated_at = now()
    where id = target_user;
  else
    delete from public.super_admins where user_id = target_user;

    update public.profiles
    set platform_role = 'user', is_super_admin = false, updated_at = now()
    where id = target_user;
  end if;
end;
$$;

revoke execute on function public.admin_set_super_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_super_admin(uuid, boolean) to authenticated;

create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  profile_name text;
  organization_name text;
  organization_slug text;
  new_organization_id uuid;
  is_admin boolean;
begin
  is_admin := exists (
    select 1
    from private.super_admin_email_allowlist a
    where a.email = lower(coalesce(new.email, ''))
  );

  profile_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'Utilisateur Tohu'
  );

  organization_name := coalesce(
    nullif(new.raw_user_meta_data->>'company_name', ''),
    case
      when position('@' in coalesce(new.email, '')) > 0
        then split_part(split_part(new.email, '@', 2), '.', 1)
      else 'Workspace Tohu'
    end
  );

  organization_slug := lower(regexp_replace(organization_name, '[^a-zA-Z0-9]+', '-', 'g'))
    || '-' || substr(new.id::text, 1, 8);
  new_organization_id := gen_random_uuid();

  insert into public.profiles (
    id, full_name, avatar_url, company_name, is_super_admin, platform_role
  )
  values (
    new.id,
    profile_name,
    new.raw_user_meta_data->>'avatar_url',
    organization_name,
    is_admin,
    case when is_admin then 'super_admin' else 'user' end
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    company_name = coalesce(excluded.company_name, public.profiles.company_name),
    is_super_admin = public.profiles.is_super_admin or excluded.is_super_admin,
    platform_role = case
      when public.profiles.platform_role = 'super_admin' or excluded.platform_role = 'super_admin'
        then 'super_admin'
      else 'user'
    end,
    updated_at = now();

  insert into public.organizations (id, name, slug)
  values (new_organization_id, initcap(organization_name), organization_slug)
  on conflict (slug) do nothing;

  select id into new_organization_id
  from public.organizations
  where slug = organization_slug
  limit 1;

  insert into public.memberships (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  insert into public.notification_preferences (organization_id, user_id)
  values (new_organization_id, new.id)
  on conflict (organization_id, user_id) do nothing;

  insert into public.privacy_settings (organization_id, user_id)
  values (new_organization_id, new.id)
  on conflict (organization_id, user_id) do nothing;

  -- Le rôle plateforme reste séparé du plan commercial.
  insert into public.subscriptions (
    organization_id,
    plan_id,
    status,
    billing_cycle,
    amount_per_period,
    started_at,
    current_period_start,
    current_period_end
  )
  values (
    new_organization_id,
    'free',
    'active',
    'monthly',
    0,
    now(),
    now(),
    now() + interval '1 month'
  )
  on conflict do nothing;

  if is_admin then
    insert into public.super_admins (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id) do update set email = excluded.email;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_new_user_workspace() from public, anon, authenticated;
