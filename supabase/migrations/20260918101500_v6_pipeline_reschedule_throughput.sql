-- classify-markers ne traitait qu'1 dyade x 1 événement par invocation, et le
-- cron ne le rappelait qu'une fois toutes les 6h sans jamais suivre son propre
-- curseur next_after/next_event_offset : ~4 événements classifiés au total
-- depuis la création de la fonction. Le code a été corrigé (jusqu'à 30
-- événements / budget de 45s par appel) ; on rapproche maintenant les crons
-- de detect/classify de la cadence d'ingestion (10 min) pour que le retard se
-- résorbe en heures et non en années. Portée déjà bornée aux entités suivies
-- (is_tracked) par la migration précédente — rapprocher la cadence n'élargit
-- pas le périmètre, seulement la vitesse de traitement de ce périmètre.

select cron.schedule('tohu-bohu-detect-dyad-markers', '7-57/10 * * * *',
  $$select private.dispatch_scheduled_edge('detect-dyad-markers', '{}'::jsonb, 30000);$$);

select cron.schedule('tohu-bohu-classify-markers', '8-58/10 * * * *',
  $$select private.dispatch_scheduled_edge('classify-markers', '{}'::jsonb, 60000);$$);

select cron.schedule('tohu-bohu-score-v6-account', '*/15 * * * *',
  $$select private.dispatch_scheduled_edge('score-batch-account-v6', '{}'::jsonb, 30000);$$);
