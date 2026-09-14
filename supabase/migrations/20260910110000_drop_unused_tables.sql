-- privacy_settings recevait une ligne par défaut à chaque inscription : il
-- faut retirer cette insertion du trigger de signup avant de supprimer la
-- table, sinon toute nouvelle inscription échouerait.
create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
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
$function$;

-- Tables créées par des migrations passées mais jamais lues ni écrites par
-- aucun code applicatif (frontend, edge functions), aucune fonction SQL, ni
-- aucun trigger, au-delà de leur propre création :
--   - contact_alerts, interaction_axis_scores, interaction_mode_scores,
--     relationship_score_narratives : jamais branchées à une fonctionnalité.
--   - knowy_activity_events : reliquat du nom de produit précédent (Knowy).
--   - nps_snapshots : fonctionnalité NPS jamais implémentée côté app.
--   - ownership_handovers : ancien mécanisme de passation, remplacé par
--     fiche_handovers (voir migration fiche_visions_and_handovers).
--   - privacy_settings : une ligne par défaut est créée à l'inscription mais
--     aucun écran ne la relit ni ne la modifie ensuite.
--   - user_behavior_events : uniquement comptée (toujours 0) par les KPIs
--     super admin ; rien ne l'alimente jamais.
drop table if exists public.contact_alerts;
drop table if exists public.interaction_axis_scores;
drop table if exists public.interaction_mode_scores;
drop table if exists public.knowy_activity_events;
drop table if exists public.nps_snapshots;
drop table if exists public.ownership_handovers;
drop table if exists public.privacy_settings;
drop table if exists public.relationship_score_narratives;
drop table if exists public.user_behavior_events;

notify pgrst, 'reload schema';
