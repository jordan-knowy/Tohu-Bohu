create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
  organization_name text;
  organization_slug text;
  new_organization_id uuid;
begin
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

  insert into public.profiles (id, full_name, avatar_url, company_name)
  values (
    new.id,
    profile_name,
    new.raw_user_meta_data->>'avatar_url',
    organization_name
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    company_name = coalesce(excluded.company_name, public.profiles.company_name),
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_workspace on auth.users;

create trigger on_auth_user_created_create_workspace
after insert on auth.users
for each row execute function public.handle_new_user_workspace();
