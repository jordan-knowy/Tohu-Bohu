-- Reconstruct deployed support contracts captured in the Phase 1 catalogue.
-- No source data copied. fiche_shares and its retired RPCs are intentionally excluded.
-- Existing columns used by transitional consumers remain until the Phase 5 retirement.
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE IF NOT EXISTS public."email_dispatch_rules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "scope_ref" text DEFAULT ''::text NOT NULL,
  "email_type" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_dispatch_rules_email_type_check" CHECK (email_type = ANY (ARRAY['digest'::text, 'antiseche'::text, 'alerte'::text, 'nurturing'::text])),
  CONSTRAINT "email_dispatch_rules_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_dispatch_rules_scope_check" CHECK (scope = ANY (ARRAY['global'::text, 'account_type'::text, 'user'::text])),
  CONSTRAINT "email_dispatch_rules_scope_scope_ref_email_type_key" UNIQUE (scope, scope_ref, email_type)
);
ALTER TABLE public."email_dispatch_rules" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."email_dispatch_rules" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."email_dispatch_rules" TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS email_dispatch_rules_pkey ON public.email_dispatch_rules USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_dispatch_rules_scope_scope_ref_email_type_key ON public.email_dispatch_rules USING btree (scope, scope_ref, email_type);

CREATE TABLE IF NOT EXISTS public."resource_lock" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "lock_state" text DEFAULT 'active'::text NOT NULL,
  "locked_by" uuid NOT NULL,
  "reason_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released_at" timestamp with time zone,
  "released_by" uuid,
  CONSTRAINT "resource_lock_lock_state_check" CHECK (lock_state = ANY (ARRAY['active'::text, 'released'::text])),
  CONSTRAINT "resource_lock_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES auth.users(id),
  CONSTRAINT "resource_lock_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT "resource_lock_pkey" PRIMARY KEY (id),
  CONSTRAINT "resource_lock_released_by_fkey" FOREIGN KEY (released_by) REFERENCES auth.users(id),
  CONSTRAINT "resource_lock_subject_type_check" CHECK (subject_type = ANY (ARRAY['contact'::text, 'company'::text]))
);
ALTER TABLE public."resource_lock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."resource_lock" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."resource_lock" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."resource_lock" TO authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS resource_lock_pkey ON public.resource_lock USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS resource_lock_active_uniq ON public.resource_lock USING btree (organization_id, subject_type, subject_id) WHERE (lock_state = 'active'::text);
CREATE INDEX IF NOT EXISTS resource_lock_org_idx ON public.resource_lock USING btree (organization_id);
DROP POLICY IF EXISTS "resource_lock_owner_insert" ON public."resource_lock";
CREATE POLICY "resource_lock_owner_insert" ON public."resource_lock" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((private.is_org_member(organization_id) AND (locked_by = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "resource_lock_owner_release" ON public."resource_lock";
CREATE POLICY "resource_lock_owner_release" ON public."resource_lock" AS PERMISSIVE FOR UPDATE TO authenticated USING ((private.is_org_member(organization_id) AND (locked_by = ( SELECT auth.uid() AS uid)))) WITH CHECK ((private.is_org_member(organization_id) AND (locked_by = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "resource_lock_select_can_view" ON public."resource_lock";
CREATE POLICY "resource_lock_select_can_view" ON public."resource_lock" AS PERMISSIVE FOR SELECT TO authenticated USING ((((subject_type = 'contact'::text) AND private.can_view_contact(organization_id, subject_id)) OR ((subject_type <> 'contact'::text) AND private.is_org_member(organization_id))));

CREATE TABLE IF NOT EXISTS public."access_grant" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "grantee_user_id" uuid NOT NULL,
  "access_level" text DEFAULT 'read'::text NOT NULL,
  "granted_by" uuid NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_to" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "access_grant_access_level_check" CHECK (access_level = ANY (ARRAY['read'::text, 'contribute'::text])),
  CONSTRAINT "access_grant_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES auth.users(id),
  CONSTRAINT "access_grant_grantee_user_id_fkey" FOREIGN KEY (grantee_user_id) REFERENCES auth.users(id),
  CONSTRAINT "access_grant_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT "access_grant_pkey" PRIMARY KEY (id),
  CONSTRAINT "access_grant_status_check" CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text, 'expired'::text])),
  CONSTRAINT "access_grant_subject_type_check" CHECK (subject_type = ANY (ARRAY['contact'::text, 'company'::text]))
);
ALTER TABLE public."access_grant" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."access_grant" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."access_grant" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."access_grant" TO authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS access_grant_pkey ON public.access_grant USING btree (id);
CREATE INDEX IF NOT EXISTS access_grant_subject_idx ON public.access_grant USING btree (organization_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS access_grant_grantee_idx ON public.access_grant USING btree (grantee_user_id);
DROP POLICY IF EXISTS "access_grant_involved_select" ON public."access_grant";
CREATE POLICY "access_grant_involved_select" ON public."access_grant" AS PERMISSIVE FOR SELECT TO authenticated USING ((private.is_org_member(organization_id) AND ((grantee_user_id = ( SELECT auth.uid() AS uid)) OR (granted_by = ( SELECT auth.uid() AS uid)))));
DROP POLICY IF EXISTS "access_grant_owner_insert" ON public."access_grant";
CREATE POLICY "access_grant_owner_insert" ON public."access_grant" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((private.is_org_member(organization_id) AND (granted_by = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "access_grant_owner_revoke" ON public."access_grant";
CREATE POLICY "access_grant_owner_revoke" ON public."access_grant" AS PERMISSIVE FOR UPDATE TO authenticated USING ((private.is_org_member(organization_id) AND (granted_by = ( SELECT auth.uid() AS uid)))) WITH CHECK ((private.is_org_member(organization_id) AND (granted_by = ( SELECT auth.uid() AS uid))));

CREATE TABLE IF NOT EXISTS public."email_preferences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "digest_enabled" boolean DEFAULT true NOT NULL,
  "digest_weekday" integer DEFAULT 1 NOT NULL,
  "digest_hour" integer DEFAULT 8 NOT NULL,
  "timezone" text DEFAULT 'Europe/Paris'::text NOT NULL,
  "antiseche_enabled" boolean DEFAULT true NOT NULL,
  "alerte_enabled" boolean DEFAULT true NOT NULL,
  "onboarding_enabled" boolean DEFAULT true NOT NULL,
  "unsubscribed_all" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "alerte_max_per_week" integer DEFAULT 3 NOT NULL,
  CONSTRAINT "email_preferences_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "email_preferences_user_id_key" UNIQUE (user_id)
);
ALTER TABLE public."email_preferences" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."email_preferences" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."email_preferences" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."email_preferences" TO authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS email_preferences_pkey ON public.email_preferences USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_preferences_user_id_key ON public.email_preferences USING btree (user_id);
DROP POLICY IF EXISTS "email_preferences_self_select" ON public."email_preferences";
CREATE POLICY "email_preferences_self_select" ON public."email_preferences" AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "email_preferences_self_update" ON public."email_preferences";
CREATE POLICY "email_preferences_self_update" ON public."email_preferences" AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "email_preferences_self_upsert" ON public."email_preferences";
CREATE POLICY "email_preferences_self_upsert" ON public."email_preferences" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public."email_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "user_id" uuid NOT NULL,
  "email_type" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "to_email" text,
  "subject" text,
  "resend_id" text,
  "status" text DEFAULT 'sent'::text NOT NULL,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_log_dedupe_key_key" UNIQUE (dedupe_key),
  CONSTRAINT "email_log_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT "email_log_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public."email_log" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."email_log" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."email_log" TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS email_log_pkey ON public.email_log USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_log_dedupe_key_key ON public.email_log USING btree (dedupe_key);
CREATE INDEX IF NOT EXISTS email_log_user_type_idx ON public.email_log USING btree (user_id, email_type, created_at DESC);

ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "relationship_age_days" integer;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "engagement_score" numeric;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "confiance_score" numeric;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "satisfaction_score" numeric;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "ancrage_score" numeric;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "ancrage_carriers" integer;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "axis_interpretation" text;
ALTER TABLE "public"."person_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "dynamique_score" numeric;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "trust_score" numeric;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "trust_reasoning" text;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "trust_analyzed_at" timestamp with time zone;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "satisfaction_score" numeric;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "satisfaction_reasoning" text;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "satisfaction_analyzed_at" timestamp with time zone;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "score_engagement" integer;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "score_confiance" integer;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "score_satisfaction" integer;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "score_ancrage" integer;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "account_relation_hint" text;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "account_relation_hint_confidence" numeric;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "account_relation_hint_reasoning" text;
ALTER TABLE "public"."cognitive_profiles" ADD COLUMN IF NOT EXISTS "account_relation_hint_analyzed_at" timestamp with time zone;
ALTER TABLE "public"."contact_score_history" ADD COLUMN IF NOT EXISTS "score_engagement" integer;
ALTER TABLE "public"."contact_score_history" ADD COLUMN IF NOT EXISTS "score_confiance" integer;
ALTER TABLE "public"."contact_score_history" ADD COLUMN IF NOT EXISTS "score_satisfaction" integer;
ALTER TABLE "public"."contact_score_history" ADD COLUMN IF NOT EXISTS "score_ancrage" integer;
ALTER TABLE "public"."contact_score_history" ADD COLUMN IF NOT EXISTS "score_dynamique" integer;
ALTER TABLE "public"."account_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "engagement_component" numeric;
ALTER TABLE "public"."account_relationship_score_snapshots" ADD COLUMN IF NOT EXISTS "recency_component" numeric;
ALTER TABLE "public"."account_settings" ADD COLUMN IF NOT EXISTS "relationship_status_source" text;
ALTER TABLE "public"."account_settings" ADD COLUMN IF NOT EXISTS "relationship_status_confidence" numeric;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "account_name" text;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "person_name" text;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "source_label" text;
ALTER TABLE "public"."home_action_states" ADD COLUMN IF NOT EXISTS "priority" integer;
ALTER TABLE "public"."ai_usage_events" ADD COLUMN IF NOT EXISTS "fn" text;
ALTER TABLE "public"."ai_usage_events" ADD COLUMN IF NOT EXISTS "prompt_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "public"."ai_usage_events" ADD COLUMN IF NOT EXISTS "completion_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "public"."ai_usage_events" ADD COLUMN IF NOT EXISTS "total_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "public"."ai_usage_events" ADD COLUMN IF NOT EXISTS "estimated_cost_usd" numeric(12,6) DEFAULT 0 NOT NULL;
ALTER TABLE "public"."account_relationship_score_snapshots_dedup_backup_20260910" ADD COLUMN IF NOT EXISTS "engagement_component" numeric;
ALTER TABLE "public"."account_relationship_score_snapshots_dedup_backup_20260910" ADD COLUMN IF NOT EXISTS "recency_component" numeric;

CREATE OR REPLACE FUNCTION public.is_super_admin_caller()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin = true);
$function$;
REVOKE ALL ON FUNCTION public.is_super_admin_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin_caller() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_seat_quantity(target_user uuid, seats integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_organization_id uuid;
  v_subscription_id uuid;
begin
  if not exists (
    select 1 from public.super_admins sa where sa.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if seats is null or seats < 1 then
    raise exception 'Le nombre de sièges doit être au moins 1';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user and u.deleted_at is null) then
    raise exception 'Utilisateur introuvable';
  end if;

  select m.organization_id
  into v_organization_id
  from public.memberships m
  where m.user_id = target_user
  order by (m.role = 'owner') desc, m.created_at desc
  limit 1;

  if v_organization_id is null then
    raise exception 'Aucun workspace associé à cet utilisateur';
  end if;

  select s.id
  into v_subscription_id
  from public.subscriptions s
  where s.organization_id = v_organization_id
  order by
    (s.status in ('active', 'trialing', 'past_due')) desc,
    s.updated_at desc
  limit 1;

  if v_subscription_id is null then
    raise exception 'Aucun abonnement pour ce workspace';
  end if;

  update public.subscriptions
  set seat_quantity = seats, updated_at = now()
  where id = v_subscription_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, target_table, target_id, metadata
  ) values (
    v_organization_id, auth.uid(), 'admin_seat_quantity_updated', 'subscriptions', v_subscription_id,
    jsonb_build_object('seat_quantity', seats)
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_seat_quantity(target_user uuid, seats integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_seat_quantity(target_user uuid, seats integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_organization_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_organization_id uuid;
  v_role text;
begin
  select i.organization_id into v_organization_id
  from public.organization_invitations i
  where i.id = p_invitation_id;

  if v_organization_id is null then
    raise exception 'Invitation introuvable';
  end if;

  select m.role into v_role
  from public.memberships m
  where m.organization_id = v_organization_id and m.user_id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Seul un owner ou un admin peut annuler une invitation';
  end if;

  update public.organization_invitations
  set status = 'revoked', updated_at = now()
  where id = p_invitation_id and status = 'pending';

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (v_organization_id, auth.uid(), 'team_invitation_revoked', 'organization_invitations', p_invitation_id, '{}'::jsonb);
end;
$function$;
REVOKE ALL ON FUNCTION public.revoke_organization_invitation(p_invitation_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invitation(p_invitation_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_dispatch_allowed(p_user_id uuid, p_email_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_type text; v_enabled boolean;
begin
  select enabled into v_enabled from public.email_dispatch_rules
    where scope='user' and scope_ref = p_user_id::text and email_type = p_email_type;
  if found then return v_enabled; end if;

  select case when coalesce(s.plan_id,'free')='tester' then 'test'
              when coalesce(s.plan_id,'free')='free' then 'free' else 'paid' end
    into v_type
  from public.memberships m
  left join public.subscriptions s on s.organization_id = m.organization_id
  where m.user_id = p_user_id limit 1;
  if v_type is not null then
    select enabled into v_enabled from public.email_dispatch_rules
      where scope='account_type' and scope_ref = v_type and email_type = p_email_type;
    if found then return v_enabled; end if;
  end if;

  select enabled into v_enabled from public.email_dispatch_rules
    where scope='global' and scope_ref='' and email_type = p_email_type;
  if found then return v_enabled; end if;

  return true;
end $function$;
REVOKE ALL ON FUNCTION public.email_dispatch_allowed(p_user_id uuid, p_email_type text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_dispatch_allowed(p_user_id uuid, p_email_type text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_email_dispatch_rules()
 RETURNS SETOF email_dispatch_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'Accès refusé'; end if;
  return query select * from public.email_dispatch_rules order by scope, scope_ref, email_type;
end $function$;
REVOKE ALL ON FUNCTION public.admin_get_email_dispatch_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_email_dispatch_rules() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_email_dispatch_rule(p_scope text, p_scope_ref text, p_email_type text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'Accès refusé'; end if;
  insert into public.email_dispatch_rules (scope, scope_ref, email_type, enabled, updated_by, updated_at)
  values (p_scope, coalesce(p_scope_ref,''), p_email_type, p_enabled, auth.uid(), now())
  on conflict (scope, scope_ref, email_type) do update set enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now();
end $function$;
REVOKE ALL ON FUNCTION public.admin_set_email_dispatch_rule(p_scope text, p_scope_ref text, p_email_type text, p_enabled boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_email_dispatch_rule(p_scope text, p_scope_ref text, p_email_type text, p_enabled boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_organization_member(p_organization_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_caller_role text;
  v_target_role text;
  v_owner_count integer;
begin
  select m.role into v_caller_role
  from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'Seul un owner ou un admin peut retirer un membre';
  end if;

  select m.role into v_target_role
  from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Ce membre ne fait pas partie de l''organisation';
  end if;

  if v_target_role = 'owner' then
    select count(*) into v_owner_count
    from public.memberships m
    where m.organization_id = p_organization_id and m.role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'Impossible de retirer le dernier owner de l''organisation';
    end if;
  end if;

  delete from public.memberships
  where organization_id = p_organization_id and user_id = p_user_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (p_organization_id, auth.uid(), 'team_member_removed', 'memberships', p_user_id, jsonb_build_object('removed_role', v_target_role));
end;
$function$;
REVOKE ALL ON FUNCTION public.remove_organization_member(p_organization_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(p_organization_id uuid, p_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_user_memberships(target_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'membership_id', m.id,
      'organization_id', m.organization_id,
      'organization_name', o.name,
      'role', m.role,
      'created_at', m.created_at
    ) order by m.created_at)
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = target_user
  ), '[]'::jsonb);
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_user_memberships(target_user uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_user_memberships(target_user uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_organizations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
    from public.organizations o
  ), '[]'::jsonb);
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_organizations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_add_user_to_organization(target_user uuid, target_organization_id uuid, target_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_role not in ('owner', 'admin', 'member') then
    raise exception 'Rôle invalide';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user and u.deleted_at is null) then
    raise exception 'Utilisateur introuvable';
  end if;

  if not exists (select 1 from public.organizations o where o.id = target_organization_id) then
    raise exception 'Organisation introuvable';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, target_user, target_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (target_organization_id, auth.uid(), 'admin_membership_added', 'memberships', target_user, jsonb_build_object('role', target_role));
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_add_user_to_organization(target_user uuid, target_organization_id uuid, target_role text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_user_to_organization(target_user uuid, target_organization_id uuid, target_role text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_remove_user_from_organization(p_membership_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_organization_id uuid;
  v_user_id uuid;
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select m.organization_id, m.user_id into v_organization_id, v_user_id
  from public.memberships m where m.id = p_membership_id;

  if v_organization_id is null then
    raise exception 'Adhésion introuvable';
  end if;

  delete from public.memberships where id = p_membership_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (v_organization_id, auth.uid(), 'admin_membership_removed', 'memberships', v_user_id, '{}'::jsonb);
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_remove_user_from_organization(p_membership_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_user_from_organization(p_membership_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_membership_role(p_membership_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_organization_id uuid;
  v_user_id uuid;
begin
  if not exists (select 1 from public.super_admins sa where sa.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Rôle invalide';
  end if;

  select m.organization_id, m.user_id into v_organization_id, v_user_id
  from public.memberships m where m.id = p_membership_id;

  if v_organization_id is null then
    raise exception 'Adhésion introuvable';
  end if;

  update public.memberships set role = p_role where id = p_membership_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (v_organization_id, auth.uid(), 'admin_membership_role_changed', 'memberships', v_user_id, jsonb_build_object('role', p_role));
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_membership_role(p_membership_id uuid, p_role text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_membership_role(p_membership_id uuid, p_role text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_locked_for(p_organization_id uuid, p_subject_type text, p_subject_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.resource_lock rl
    where rl.organization_id = p_organization_id
      and rl.subject_type = p_subject_type
      and rl.subject_id = p_subject_id
      and rl.lock_state = 'active'
      and rl.locked_by <> p_user_id
      and not exists (
        select 1 from public.access_grant ag
        where ag.organization_id = p_organization_id
          and ag.subject_type = p_subject_type
          and ag.subject_id = p_subject_id
          and ag.grantee_user_id = p_user_id
          and ag.status = 'active'
          and ag.valid_from <= now()
          and (ag.valid_to is null or ag.valid_to > now())
      )
  );
$function$;
REVOKE ALL ON FUNCTION private.is_locked_for(p_organization_id uuid, p_subject_type text, p_subject_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_locked_for(p_organization_id uuid, p_subject_type text, p_subject_id uuid, p_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.super_admin_ai_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  if not public.is_super_admin_caller() then raise exception 'forbidden'; end if;
  with base as (select * from public.ai_usage_events where fn is not null),
  period as (select p.label, p.since from (values
    ('day',now()-interval '1 day'),('week',now()-interval '7 days'),('month',now()-interval '30 days'),
    ('year',now()-interval '365 days'),('all',timestamptz '1970-01-01')) as p(label,since)),
  totals as (select period.label, count(base.id) calls, coalesce(sum(base.total_tokens),0) tokens, coalesce(sum(base.estimated_cost_usd),0) cost
    from period left join base on base.created_at >= period.since group by period.label),
  agg_fn as (select fn, count(*) calls, coalesce(sum(total_tokens),0) tokens, coalesce(sum(estimated_cost_usd),0) cost
    from base where created_at >= now()-interval '30 days' group by fn order by cost desc),
  agg_model as (select model, count(*) calls, coalesce(sum(total_tokens),0) tokens, coalesce(sum(estimated_cost_usd),0) cost
    from base where created_at >= now()-interval '30 days' group by model order by cost desc),
  agg_day as (select to_char(date_trunc('day',created_at),'YYYY-MM-DD') as d, count(*) calls, coalesce(sum(total_tokens),0) tokens, coalesce(sum(estimated_cost_usd),0) cost
    from base where created_at >= now()-interval '30 days' group by 1 order by 1),
  agg_user as (select b.user_id, coalesce(pr.full_name,'—') full_name, count(*) calls, coalesce(sum(b.total_tokens),0) tokens, coalesce(sum(b.estimated_cost_usd),0) cost
    from base b left join public.profiles pr on pr.id=b.user_id where b.created_at >= now()-interval '30 days' group by b.user_id, pr.full_name order by cost desc limit 20)
  select jsonb_build_object(
    'generated_at', now(),
    'totals', (select jsonb_object_agg(label, jsonb_build_object('calls',calls,'tokens',tokens,'cost',cost)) from totals),
    'by_function', coalesce((select jsonb_agg(jsonb_build_object('fn',fn,'calls',calls,'tokens',tokens,'cost',cost)) from agg_fn),'[]'),
    'by_model', coalesce((select jsonb_agg(jsonb_build_object('model',model,'calls',calls,'tokens',tokens,'cost',cost)) from agg_model),'[]'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day',d,'calls',calls,'tokens',tokens,'cost',cost)) from agg_day),'[]'),
    'by_user', coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'full_name',full_name,'calls',calls,'tokens',tokens,'cost',cost)) from agg_user),'[]')
  ) into result;
  return result;
end; $function$;
REVOKE ALL ON FUNCTION public.super_admin_ai_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_ai_usage() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_orgs_deleted int;
  v_email text;
begin
  if not public.is_super_admin_caller() then raise exception 'forbidden'; end if;
  if p_user_id is null then raise exception 'Utilisateur cible manquant.'; end if;
  if p_user_id = v_caller then raise exception 'Impossible de supprimer votre propre compte.'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_super_admin = true) then
    raise exception 'Impossible de supprimer un super administrateur (retire d''abord ce rôle).';
  end if;

  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'Utilisateur introuvable.'; end if;

  with target_orgs as (
    select distinct m.organization_id
    from public.memberships m
    where m.user_id = p_user_id
      and (m.role = 'owner'
        or (select count(*) from public.memberships m2 where m2.organization_id = m.organization_id) = 1)
  ), del_orgs as (
    delete from public.organizations o using target_orgs t where o.id = t.organization_id returning o.id
  )
  select count(*) into v_orgs_deleted from del_orgs;

  delete from public.memberships where user_id = p_user_id;
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('deleted_email', v_email, 'organizations_deleted', v_orgs_deleted);
end; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_user(p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(p_user_id uuid) TO authenticated, service_role;

-- Remote API contract refinements absent from the historical migration replay.
DO $$ BEGIN
  IF pg_get_function_result('public.accept_my_organization_invitations()'::regprocedure) = 'integer' THEN
    -- No CASCADE: unexpected dependents must block this contract migration.
    DROP FUNCTION public.accept_my_organization_invitations();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.detect_contact_merge_candidates(p_organization_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;

  perform extensions.set_limit(0.6);

  with common_names as (
    select public.normalize_entity_name(full_name) as norm_name
    from public.contacts
    where organization_id = p_organization_id and merged_into_contact_id is null
    group by public.normalize_entity_name(full_name)
    having count(*) > 2
  ),
  name_tokens as (
    select c.id, tok.token, tok.ord
    from public.contacts c,
      lateral unnest(regexp_split_to_array(public.normalize_entity_name(c.full_name), '\s+')) with ordinality as tok(token, ord)
    where c.organization_id = p_organization_id
      and c.merged_into_contact_id is null
      and tok.token <> ''
  ),
  common_tokens as (
    select token from name_tokens
    group by token
    having count(distinct id) > 4
  ),
  core_names as (
    -- Un noyau de moins de 3 caractères ("Mc", "Tb"...) n'est pas un identifiant
    -- fiable de personne : trop court pour distinguer qui que ce soit.
    select nt.id,
      case when length(btrim(string_agg(nt.token, ' ' order by nt.ord))) >= 3
        then btrim(string_agg(nt.token, ' ' order by nt.ord))
        else null
      end as core_name
    from name_tokens nt
    where nt.token not in (select token from common_tokens)
    group by nt.id
  ),
  name_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join core_names ca on ca.id = a.id
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
    join core_names cb on cb.id = b.id
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and ca.core_name is not null
      and cb.core_name is not null
      and ca.core_name % cb.core_name
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(a.full_name))
      and not exists (select 1 from common_names cn where cn.norm_name = public.normalize_entity_name(b.full_name))
  ),
  linkedin_matches as (
    select a.id as contact_a_id, b.id as contact_b_id
    from public.contacts a
    join public.contacts b
      on b.organization_id = a.organization_id
      and b.id <> a.id
      and b.merged_into_contact_id is null
      and b.linkedin_url = a.linkedin_url
    where a.organization_id = p_organization_id
      and a.merged_into_contact_id is null
      and a.linkedin_url ~* '^https?://([a-z]{2,3}\.)?linkedin\.com/in/'
  ),
  pairs as (
    select distinct least(contact_a_id, contact_b_id) as contact_a_id, greatest(contact_a_id, contact_b_id) as contact_b_id
    from name_matches
    union
    select distinct least(contact_a_id, contact_b_id), greatest(contact_a_id, contact_b_id)
    from linkedin_matches
  ),
  scored as (
    select
      p.contact_a_id, p.contact_b_id,
      a.full_name as name_a, b.full_name as name_b,
      coalesce(ca.core_name, public.normalize_entity_name(a.full_name)) as core_a,
      coalesce(cb.core_name, public.normalize_entity_name(b.full_name)) as core_b,
      a.email as email_a, b.email as email_b,
      a.linkedin_url as linkedin_a, b.linkedin_url as linkedin_b,
      a.company_id as company_a, b.company_id as company_b
    from pairs p
    join public.contacts a on a.id = p.contact_a_id
    join public.contacts b on b.id = p.contact_b_id
    left join core_names ca on ca.id = a.id
    left join core_names cb on cb.id = b.id
  )
  insert into public.contact_merge_suggestions (organization_id, contact_a_id, contact_b_id, confidence, evidence)
  select
    p_organization_id, contact_a_id, contact_b_id,
    case
      when linkedin_a is not null and linkedin_a = linkedin_b then 'high'
      when (public.entity_name_shares_surname(name_a, name_b) or public.entity_name_shares_surname(name_b, name_a))
        and company_a is not distinct from company_b and company_a is not null then 'high'
      when extensions.similarity(core_a, core_b) >= 0.75 then 'high'
      else 'medium'
    end,
    jsonb_build_object(
      'name_similarity', round(extensions.similarity(core_a, core_b)::numeric, 2),
      'shares_surname', (public.entity_name_shares_surname(name_a, name_b) or public.entity_name_shares_surname(name_b, name_a)),
      'linkedin_match', (linkedin_a is not null and linkedin_a = linkedin_b),
      'same_company', (company_a is not distinct from company_b and company_a is not null),
      'contact_a_name', name_a, 'contact_b_name', name_b,
      'contact_a_email', email_a, 'contact_b_email', email_b
    )
  from scored
  where public.normalize_identity_email(email_a) is distinct from public.normalize_identity_email(email_b)
  on conflict (organization_id, contact_a_id, contact_b_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
REVOKE ALL ON FUNCTION public.detect_contact_merge_candidates(p_organization_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_contact_merge_candidates(p_organization_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_my_organization_invitations()
 RETURNS TABLE(organization_name text, inviter_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_email text;
  v_invitation public.organization_invitations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan_limit integer;
  v_member_count integer;
  v_unlimited boolean;
  v_org_name text;
  v_inviter_name text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return; end if;

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
    v_unlimited := coalesce(v_plan_limit, 1) < 0;

    if v_unlimited or v_member_count < least(
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

      select o.name into v_org_name from public.organizations o where o.id = v_invitation.organization_id;
      select p.full_name into v_inviter_name from public.profiles p where p.id = v_invitation.invited_by;
      organization_name := coalesce(v_org_name, 'l’équipe');
      inviter_name := v_inviter_name;
      return next;
    end if;
  end loop;
end;
$function$;
REVOKE ALL ON FUNCTION public.accept_my_organization_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_organization_invitations() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_tracked_companies(p_organization_id uuid, p_selection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_job_id uuid;
  v_plan text;
  v_limit integer;
  v_count integer;
  v_item jsonb;
  v_company_id uuid;
  v_name text;
  v_domain text;
  v_tracked integer := 0;
  v_linked integer := 0;
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;
  if p_selection is null or jsonb_typeof(p_selection) <> 'array' then
    raise exception 'Sélection invalide';
  end if;
  v_count := jsonb_array_length(p_selection);
  if v_count < 1 then
    raise exception 'Sélectionne au moins un compte';
  end if;

  select s.plan_id::text into v_plan
  from public.subscriptions s
  where s.organization_id = p_organization_id
  limit 1;
  v_plan := coalesce(v_plan, 'free');

  begin
    execute format('select p.max_tracked_accounts from public.subscription_plans p where p.id::text = %L limit 1', v_plan)
    into v_limit;
  exception when undefined_table or undefined_column then
    v_limit := null;
  end;

  if v_limit is not null and v_count > v_limit then
    raise exception 'Le forfait % est limité à % comptes suivis (% demandés)', v_plan, v_limit, v_count;
  end if;

  insert into public.sync_jobs (organization_id, user_id, job_type, status, current_step, progress, started_at, payload)
  values (p_organization_id, auth.uid(), 'account_analysis', 'running', 'Activation des comptes sélectionnés', 20, now(), '{}'::jsonb)
  returning id into v_job_id;

  -- La sélection remplace le portefeuille suivi.
  update public.companies
  set is_tracked = false, tracked_at = null, tracked_by = null
  where organization_id = p_organization_id and is_tracked;

  for v_item in select * from jsonb_array_elements(p_selection) loop
    v_company_id := nullif(v_item ->> 'company_id', '')::uuid;
    v_name := nullif(trim(v_item ->> 'name'), '');
    v_domain := nullif(lower(trim(v_item ->> 'domain')), '');

    if v_company_id is not null then
      -- jamais un compte d'un autre workspace
      select id into v_company_id from public.companies
      where id = v_company_id and organization_id = p_organization_id;
    end if;
    if v_company_id is null and (v_domain is not null or v_name is not null) then
      select id into v_company_id from public.companies
      where organization_id = p_organization_id
        and ((v_domain is not null and lower(coalesce(domain, '')) = v_domain)
             or (v_name is not null and lower(name) = lower(v_name)))
      limit 1;
    end if;
    if v_company_id is null then
      if v_name is null then continue; end if;
      insert into public.companies (organization_id, name, domain, public_context)
      values (p_organization_id, v_name, v_domain, '{}'::jsonb)
      returning id into v_company_id;
    end if;

    update public.companies
    set is_tracked = true, tracked_at = now(), tracked_by = auth.uid(), domain = coalesce(domain, v_domain)
    where id = v_company_id and organization_id = p_organization_id;
    v_tracked := v_tracked + 1;
  end loop;

  -- Garde-fou final : la limite s'applique au portefeuille réellement suivi.
  if v_limit is not null then
    select count(*) into v_count from public.companies
    where organization_id = p_organization_id and is_tracked;
    if v_count > v_limit then
      raise exception 'Le forfait % est limité à % comptes suivis', v_plan, v_limit;
    end if;
  end if;

  update public.sync_jobs
  set current_step = 'Rattachement des personnes détectées', progress = 70
  where id = v_job_id;

  -- Rattache les contacts orphelins dont le domaine email correspond à un compte suivi.
  with tracked_domains as (
    select id, lower(domain) as domain
    from public.companies
    where organization_id = p_organization_id and is_tracked and domain is not null
  )
  update public.contacts c
  set company_id = td.id
  from tracked_domains td
  where c.organization_id = p_organization_id
    and c.company_id is null
    and c.merged_into_contact_id is null
    and c.email is not null
    and lower(split_part(c.email, '@', 2)) = td.domain;
  get diagnostics v_linked = row_count;

  update public.sync_jobs
  set status = 'succeeded',
      current_step = 'Portefeuille initialisé',
      progress = 100,
      completed_at = now(),
      payload = jsonb_build_object('tracked', v_tracked, 'linked_contacts', v_linked)
  where id = v_job_id;

  return jsonb_build_object('job_id', v_job_id, 'tracked', v_tracked, 'linked_contacts', v_linked);
end;
$function$;
REVOKE ALL ON FUNCTION public.set_tracked_companies(p_organization_id uuid, p_selection jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tracked_companies(p_organization_id uuid, p_selection jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.detect_account_candidates(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_job_id uuid;
  v_candidates jsonb;
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  insert into public.sync_jobs (organization_id, user_id, job_type, status, current_step, progress, started_at, payload)
  values (p_organization_id, auth.uid(), 'account_detection', 'running', 'Détection des organisations', 30, now(), '{}'::jsonb)
  returning id into v_job_id;

  with contact_domains as (
    select c.id as contact_id,
           c.full_name as full_name,
           lower(split_part(c.email, '@', 2)) as domain,
           lower(split_part(c.email, '@', 1)) as local_part
    from public.contacts c
    where c.organization_id = p_organization_id
      and c.merged_into_contact_id is null
      and c.email is not null
      and position('@' in c.email) > 1
  ),
  business_domains as (
    select cd.contact_id, cd.full_name, cd.domain
    from contact_domains cd
    where cd.domain <> ''
      and cd.domain not in (
        'gmail.com','googlemail.com','outlook.com','outlook.fr','hotmail.com','hotmail.fr',
        'yahoo.com','yahoo.fr','orange.fr','free.fr','wanadoo.fr','icloud.com','live.com',
        'live.fr','sfr.fr','laposte.net','protonmail.com','proton.me','gmx.com','gmx.fr',
        'msn.com','aol.com','me.com','mac.com','bbox.fr','neuf.fr','numericable.fr'
      )
      and cd.domain not in (
        'avocat.fr','avocats.fr','avocat.com','notaires.fr','notaire.fr','huissier-justice.fr'
      )
      and not (cd.local_part ~ '(^|[._+-])(no-?reply|noreply|donotreply|do-?not-?reply|bounce|mailer-daemon|postmaster|notification|notifications|alert|alerts|newsletter|newsletters|digest|update|updates|marketing|campaign|campaigns|mailer|mailing)([._+-]|$)')
  ),
  message_stats as (
    select bd.domain,
           count(m.id) as message_count,
           count(*) filter (where m.direction = 'outbound') as outbound_count,
           max(m.sent_at) as last_message_at,
           min(m.sent_at) as first_message_at
    from business_domains bd
    left join public.communication_messages m
      on m.contact_id = bd.contact_id
     and m.organization_id = p_organization_id
     and coalesce(m.direction, 'unknown') in ('inbound','outbound','internal')
    group by bd.domain
  ),
  domain_people as (
    select domain,
           count(*) as contact_count,
           (array_agg(full_name order by full_name) filter (where full_name is not null))[1:5] as contact_names
    from business_domains
    group by domain
  ),
  matched as (
    select ms.domain,
           dp.contact_count,
           dp.contact_names,
           ms.message_count,
           ms.outbound_count,
           ms.last_message_at,
           ms.first_message_at,
           co.id as company_id,
           co.name as company_name,
           co.industry as industry,
           co.public_context as public_context,
           coalesce(co.is_tracked, false) as already_tracked
    from message_stats ms
    join domain_people dp using (domain)
    left join lateral (
      select c.* from public.companies c
      where c.organization_id = p_organization_id
        and (lower(coalesce(c.domain, '')) = ms.domain
             or lower(c.name) = replace(split_part(ms.domain, '.', 1), '-', ' '))
      limit 1
    ) co on true
    where coalesce(ms.message_count, 0) >= 1
       or coalesce(co.is_tracked, false)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', company_id,
           'name', coalesce(company_name, initcap(replace(split_part(domain, '.', 1), '-', ' '))),
           'domain', domain,
           'industry', industry,
           'location', public_context ->> 'location',
           'interactions', coalesce(message_count, 0),
           'interlocutor_count', coalesce(contact_count, 0),
           'interlocutors', to_jsonb(coalesce(contact_names, array[]::text[])),
           'first_interaction_at', first_message_at,
           'last_interaction_at', last_message_at,
           'source', 'Messagerie connectée',
           'already_tracked', already_tracked
         ) order by coalesce(message_count, 0) desc, domain), '[]'::jsonb)
  into v_candidates
  from matched;

  update public.sync_jobs
  set status = 'succeeded',
      current_step = 'Préparation des résultats',
      progress = 100,
      completed_at = now(),
      payload = jsonb_build_object('candidates', v_candidates)
  where id = v_job_id;

  return jsonb_build_object('job_id', v_job_id, 'candidates', v_candidates);
end;
$function$;
REVOKE ALL ON FUNCTION public.detect_account_candidates(p_organization_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_account_candidates(p_organization_id uuid) TO authenticated, service_role;
