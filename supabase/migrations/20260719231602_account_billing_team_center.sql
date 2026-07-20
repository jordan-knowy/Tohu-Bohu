-- Centre Account : catalogue commercial, sièges, invitations et lecture agrégée.
-- Stripe reste la source de vérité : les colonnes ci-dessous ne sont mises à jour
-- définitivement que par le webhook serveur.

alter table public.subscription_plans
  add column if not exists stripe_price_monthly_id text,
  add column if not exists stripe_price_yearly_id text;

alter table public.subscriptions
  add column if not exists seat_quantity integer not null default 1
    check (seat_quantity > 0),
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists stripe_price_id text;

-- Réconcilie les abonnements historiques avec le nombre de membres déjà actifs.
update public.subscriptions s
set seat_quantity = greatest(
  1,
  (select count(*)::integer from public.memberships m where m.organization_id = s.organization_id)
);

insert into public.subscription_plans (
  id, name, description, price_monthly, price_yearly, max_licenses,
  max_briefs_per_month, max_ai_calls_per_month, max_storage_gb,
  max_profiles_per_month, max_tracked_accounts, features, is_active, sort_order, entitlements
)
values (
  'solo', 'Solo', 'La boucle Prepare pour les professionnels indépendants.',
  2900, 29000, 1, -1, -1, 5, 500, 25,
  '["Briefs comportementaux illimités","Radar complet sur 4 axes","Préparation multi-participants","Recommandations comportementales","1 siège"]'::jsonb,
  true, 2,
  jsonb_build_object(
    'briefs_behavioral', true, 'briefs_monthly_limit', null, 'radar_4_axes', 'full',
    'objections_and_postures', true, 'calendar_multi_participant', true,
    'persistent_relationship_memory', false, 'transcript_ingestion', false,
    'crm_push', false, 'crm_record_creation', false, 'adaptive_briefs', false,
    'activity_feed', 'limited', 'manager_analytics', false, 'portfolio_view', false,
    'team_management', false
  )
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly,
  max_licenses = excluded.max_licenses,
  max_profiles_per_month = excluded.max_profiles_per_month,
  max_tracked_accounts = excluded.max_tracked_accounts,
  features = excluded.features,
  is_active = true,
  sort_order = excluded.sort_order,
  entitlements = excluded.entitlements;

update public.subscription_plans
set
  name = 'Free',
  description = 'Découvrir la valeur de Tohu.',
  price_monthly = 0,
  price_yearly = 0,
  max_licenses = 1,
  max_briefs_per_month = 5,
  max_profiles_per_month = 25,
  max_tracked_accounts = 5,
  features = '["5 briefs comportementaux par mois","5 comptes suivis","25 personnes suivies","Ask Tohu avec quota","1 siège"]'::jsonb,
  sort_order = 1,
  is_active = true,
  entitlements = entitlements || jsonb_build_object(
    'briefs_behavioral', true, 'briefs_monthly_limit', 5, 'radar_4_axes', 'limited',
    'persistent_relationship_memory', false, 'transcript_ingestion', false,
    'crm_push', false, 'activity_feed', 'limited', 'manager_analytics', false,
    'portfolio_view', false, 'team_management', false
  )
where id = 'free';

update public.subscription_plans
set
  name = 'Pro',
  description = 'La mémoire relationnelle qui s’accumule.',
  price_monthly = 4900,
  price_yearly = 49000,
  max_licenses = 10,
  max_tracked_accounts = coalesce(max_tracked_accounts, 100),
  features = '["Tout Solo","Mémoire relationnelle persistante","Ingestion des transcripts","Synchronisation CRM","Activity Feed complet","Jusqu’à 10 sièges"]'::jsonb,
  sort_order = 3,
  is_active = true,
  entitlements = entitlements || jsonb_build_object(
    'briefs_behavioral', true, 'radar_4_axes', 'full',
    'persistent_relationship_memory', true, 'transcript_ingestion', true,
    'crm_push', true, 'crm_record_creation', true, 'adaptive_briefs', true,
    'activity_feed', 'full', 'manager_analytics', false,
    'portfolio_view', 'limited', 'team_management', true
  )
where id = 'pro';

update public.subscription_plans
set
  name = 'Business',
  description = 'Pilotage d’équipe et signaux proactifs.',
  price_monthly = 8900,
  price_yearly = 89000,
  max_licenses = 100,
  features = '["Tout Pro","Gestion d’équipe et des sièges","Analytics manager","Vue portefeuille","Signaux proactifs","Mémoire d’équipe"]'::jsonb,
  sort_order = 4,
  is_active = true,
  entitlements = entitlements || jsonb_build_object(
    'briefs_behavioral', true, 'radar_4_axes', 'full',
    'persistent_relationship_memory', true, 'transcript_ingestion', true,
    'crm_push', true, 'crm_record_creation', true, 'adaptive_briefs', true,
    'activity_feed', 'full', 'manager_analytics', true,
    'portfolio_view', 'full', 'team_management', true
  )
where id = 'business';

-- Les offres historiques restent référentielles pour ne casser aucun abonnement,
-- mais elles ne sont plus proposées dans l’interface commerciale.
update public.subscription_plans
set is_active = false
where id in ('enterprise', 'super_admin');

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create index if not exists organization_invitations_org_status_idx
  on public.organization_invitations (organization_id, status);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

alter table public.organization_invitations enable row level security;

drop policy if exists organization_invitations_member_read on public.organization_invitations;
create policy organization_invitations_member_read
  on public.organization_invitations for select to authenticated
  using (private.is_org_member(organization_id));

grant select on public.organization_invitations to authenticated;
grant all on public.organization_invitations to service_role;

create or replace function public.get_account_center(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, auth, pg_temp
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
      where i.organization_id = p_organization_id and i.status = 'pending'
    ), '[]'::jsonb),
    'connectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'provider', c.provider, 'status', c.status,
        'last_synced_at', c.last_synced_at,
        'account_email', c.metadata ->> 'account_email'
      ) order by c.provider)
      from public.connectors c
      where c.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_account_center(uuid) from public;
grant execute on function public.get_account_center(uuid) to authenticated;

create or replace function public.accept_my_organization_invitations()
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_invitation public.organization_invitations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan_limit integer;
  v_member_count integer;
  v_accepted integer := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;

  for v_invitation in
    select * from public.organization_invitations
    where email = v_email and status = 'pending' and expires_at > now()
    order by created_at
  loop
    select * into v_subscription from public.subscriptions
    where organization_id = v_invitation.organization_id
    order by created_at desc limit 1;
    select max_licenses into v_plan_limit
    from public.subscription_plans
    where id = coalesce(v_subscription.plan_id, 'free');
    select count(*) into v_member_count from public.memberships
    where organization_id = v_invitation.organization_id;

    if v_member_count < least(
      greatest(coalesce(v_subscription.seat_quantity, 1), 1),
      greatest(coalesce(v_plan_limit, 1), 1)
    ) then
      insert into public.memberships (organization_id, user_id, role)
      values (v_invitation.organization_id, auth.uid(), v_invitation.role)
      on conflict (organization_id, user_id) do update set role = excluded.role;

      update public.organization_invitations
      set status = 'accepted', accepted_at = now(), updated_at = now()
      where id = v_invitation.id;

      insert into public.audit_logs (
        organization_id, actor_user_id, action, target_table, target_id, metadata
      ) values (
        v_invitation.organization_id, auth.uid(), 'team_invitation_accepted',
        'memberships', auth.uid(), jsonb_build_object('email', v_email, 'role', v_invitation.role)
      );
      v_accepted := v_accepted + 1;
    end if;
  end loop;
  return v_accepted;
end;
$$;

revoke all on function public.accept_my_organization_invitations() from public;
grant execute on function public.accept_my_organization_invitations() to authenticated;
