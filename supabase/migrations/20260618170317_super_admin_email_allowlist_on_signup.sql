create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  profile_name text;
  organization_name text;
  organization_slug text;
  new_organization_id uuid;
  is_admin boolean;
begin
  is_admin := lower(coalesce(new.email, '')) in ('contact@webfityou.com', 'jordan@knowr.co', 'maxime@knowr.co');

  profile_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'Utilisateur Knowy'
  );

  organization_name := coalesce(
    nullif(new.raw_user_meta_data->>'company_name', ''),
    case
      when position('@' in coalesce(new.email, '')) > 0 then split_part(split_part(new.email, '@', 2), '.', 1)
      else 'Workspace Knowy'
    end
  );

  organization_slug := lower(regexp_replace(organization_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 8);
  new_organization_id := gen_random_uuid();

  insert into public.profiles (id, full_name, avatar_url, company_name, is_super_admin)
  values (new.id, profile_name, new.raw_user_meta_data->>'avatar_url', organization_name, is_admin)
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    company_name = coalesce(excluded.company_name, public.profiles.company_name),
    is_super_admin = public.profiles.is_super_admin or excluded.is_super_admin,
    updated_at = now();

  insert into public.organizations (id, name, slug)
  values (new_organization_id, initcap(organization_name), organization_slug)
  on conflict (slug) do nothing;

  select id into new_organization_id from public.organizations where slug = organization_slug limit 1;

  insert into public.memberships (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  insert into public.notification_preferences (organization_id, user_id)
  values (new_organization_id, new.id)
  on conflict (organization_id, user_id) do nothing;

  insert into public.privacy_settings (organization_id, user_id)
  values (new_organization_id, new.id)
  on conflict (organization_id, user_id) do nothing;

  insert into public.subscriptions (organization_id, plan_id, status, billing_cycle, amount_per_period, started_at, current_period_start, current_period_end)
  values (new_organization_id, case when is_admin then 'super_admin' else 'free' end, 'active', 'monthly', 0, now(), now(), now() + interval '1 month')
  on conflict do nothing;

  if is_admin then
    insert into public.super_admins (user_id, email)
    values (new.id, new.email)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;
