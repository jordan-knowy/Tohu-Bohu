-- Les privilèges par défaut Supabase accordent parfois EXECUTE explicitement
-- à anon lors de la création d'une fonction, indépendamment du rôle PUBLIC.
revoke execute on function public.get_account_center(uuid) from anon;
revoke execute on function public.accept_my_organization_invitations() from anon;

-- La table d'idempotence reste lisible uniquement par service_role. Cette
-- politique volontairement fausse documente cette intention pour le linter RLS.
drop policy if exists stripe_webhook_events_no_client_access
  on public.stripe_webhook_events;
create policy stripe_webhook_events_no_client_access
  on public.stripe_webhook_events for all to authenticated
  using (false) with check (false);
