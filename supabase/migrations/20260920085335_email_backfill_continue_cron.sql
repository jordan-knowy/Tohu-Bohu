-- Reprise rapide et automatique du backfill des boîtes mail.
--
-- Le cron `tohu-bohu-email-backfill` ne passe que toutes les 6 h et une passe ne lit que ~500 messages :
-- une grosse boîte mettait des jours à se remonter, sauf à demander aux utilisateurs de cliquer
-- « Synchroniser » à répétition. Ce cron appelle le mode `backfill_continue` de sync-email-analysis, qui ne
-- traite que les connecteurs au backfill inachevé (un par tick) et s'éteint de lui-même dès qu'ils sont
-- complets — l'ingestion incrémentale (`tohu-bohu-email-incremental`) prend alors le relais.
select cron.schedule(
  'tohu-bohu-email-backfill-continue',
  '*/4 * * * *',
  $job$select private.dispatch_scheduled_edge('sync-email-analysis', '{"mode":"backfill_continue"}'::jsonb, 1000);$job$
);
