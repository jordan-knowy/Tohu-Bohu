-- La fonction de trigger n'est jamais un RPC public : elle est appelée
-- exclusivement par PostgreSQL lors d'une mutation de subscriptions.

revoke all on function public.record_subscription_change() from public, anon, authenticated;
grant execute on function public.record_subscription_change() to service_role;

drop policy if exists subscription_change_history_no_direct_access
  on public.subscription_change_history;
create policy subscription_change_history_no_direct_access
  on public.subscription_change_history
  for all
  to anon, authenticated
  using (false)
  with check (false);
