-- Confiance n'avait que C01/C05, très rares dans un email, donc l'axe restait à 50 pour tous les
-- contacts. Ajout ADDITIF (aucun marqueur existant modifié) de quatre marqueurs observables dans le
-- corps des échanges, avec citation exacte, alignés sur la définition affichée de l'axe.
insert into scoring.marker_registry(registry_version,marker_id,scope,axis_or_dial,tier,pts_spec,sign,vol_base,manipulable,cost,detection_rule) values
('reg-v6.0','C06','person','confiance','moyen',10,1,1,'difficile','moyen','le contact nous confie une tâche, une décision ou une responsabilité'),
('reg-v6.0','C07','person','confiance','moyen',10,1,1,'difficile','moyen','le contact sollicite notre avis ou notre expertise'),
('reg-v6.0','C08','person','confiance','moyen',12,1,1,'difficile','moyen','engagement ferme du contact envers nous (action précise + échéance ou confirmation)'),
('reg-v6.0','C09','person','confiance','moyen',-14,-1,1,'non','moyen','le contact remet en cause notre fiabilité ou exige des garanties')
on conflict do nothing;
