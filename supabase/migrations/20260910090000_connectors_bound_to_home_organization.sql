-- Un connecteur (Gmail, Outlook, Slack, Notion, HubSpot, Teams, Read AI) est
-- strictement personnel : il appartient à une personne, jamais à une
-- organisation qu'elle visite. Jusqu'ici il était créé avec l'organization_id
-- affichée dans le navigateur au moment du clic — un membre appartenant à
-- plusieurs organisations pouvait donc faire atterrir ses propres emails dans
-- le CRM d'une organisation cliente/partenaire. On le fige désormais sur
-- l'organisation « foyer » de l'utilisateur (celle dont il est owner, sinon sa
-- plus ancienne organisation).

create or replace function private.home_organization_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id
  from public.memberships
  where user_id = p_user_id
  order by (role = 'owner') desc, created_at asc
  limit 1
$$;

revoke all on function private.home_organization_id(uuid) from public, anon;
grant execute on function private.home_organization_id(uuid) to authenticated, service_role;

-- Fusionne les connecteurs déjà dupliqués par organisation avant de resserrer
-- la contrainte : on garde la ligne du foyer si elle existe et qu'elle est
-- connectée, sinon la plus récemment mise à jour.
with ranked as (
  select
    id, user_id, provider, organization_id,
    row_number() over (
      partition by user_id, provider
      order by
        (organization_id = private.home_organization_id(user_id)) desc,
        (status = 'connected') desc,
        updated_at desc
    ) as rnk
  from public.connectors
)
delete from public.connectors c
using ranked r
where c.id = r.id and r.rnk > 1;

update public.connectors
set organization_id = private.home_organization_id(user_id), updated_at = now()
where private.home_organization_id(user_id) is not null
  and organization_id is distinct from private.home_organization_id(user_id);

alter table public.connectors drop constraint if exists connectors_organization_id_user_id_provider_key;
alter table public.connectors add constraint connectors_user_id_provider_key unique (user_id, provider);

create or replace function private.enforce_connector_home_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_home_organization_id uuid;
begin
  v_home_organization_id := private.home_organization_id(new.user_id);
  if v_home_organization_id is not null then
    new.organization_id := v_home_organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists connectors_enforce_home_organization on public.connectors;
create trigger connectors_enforce_home_organization
before insert or update of user_id on public.connectors
for each row execute function private.enforce_connector_home_organization();

-- Un membre ne doit jamais voir le connecteur (statut, adresse email) d'un
-- autre membre de son organisation, même via cette fonction SECURITY DEFINER
-- qui contournait la policy RLS connectors_owner.
create or replace function public.get_account_center(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $$
declare
  v_membership public.memberships%rowtype;
begin
  select * into v_membership
  from public.memberships
  where organization_id = p_organization_id and user_id = auth.uid();

  if v_membership.id is null then
    raise exception 'not authorized';
  end if;

  return jsonb_build_object(
    'organization', (
      select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug)
      from public.organizations o where o.id = p_organization_id
    ),
    'can_manage', v_membership.role in ('owner', 'admin'),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'price_monthly', p.price_monthly, 'price_yearly', p.price_yearly,
        'max_licenses', p.max_licenses, 'features', p.features,
        'entitlements', p.entitlements
      ) order by p.sort_order)
      from public.subscription_plans p
      where p.id in ('free', 'solo', 'pro', 'business') and p.is_active
    ), '[]'::jsonb),
    'subscription', coalesce((
      select to_jsonb(s) - 'stripe_customer_id' - 'stripe_subscription_id' - 'stripe_price_id'
      from public.subscriptions s
      where s.organization_id = p_organization_id
      order by s.created_at desc limit 1
    ), jsonb_build_object(
      'plan_id', 'free', 'status', 'active', 'billing_cycle', 'monthly',
      'amount_per_period', 0, 'seat_quantity', 1
    )),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'full_name', coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)),
        'email', u.email,
        'avatar_url', p.avatar_url,
        'role', m.role,
        'created_at', m.created_at
      ) order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end, m.created_at)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.organization_id = p_organization_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role,
        'status', i.status, 'expires_at', i.expires_at, 'created_at', i.created_at
      ) order by i.created_at desc)
      from public.organization_invitations i
      where i.organization_id = p_organization_id and i.status in ('pending', 'revoked')
    ), '[]'::jsonb),
    'connectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'provider', c.provider, 'status', c.status,
        'last_synced_at', c.last_synced_at,
        'account_email', c.metadata ->> 'account_email'
      ) order by c.provider)
      from public.connectors c
      where c.organization_id = p_organization_id
        and c.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
