# Outils V6

Scripts ponctuels liés à la reconstruction et à l'audit du moteur de scoring V6. Aucun n'est exécuté en production ni par la CI — à lancer manuellement au besoin.

- **`v6-export-gold-candidates.py`** — construit, en lecture seule, des extraits candidats à l'annotation pour `evaluation/relational-intelligence/` (pseudonymise identités/emails/URLs/téléphones ; sortie gitignorée). Nécessite `SUPABASE_ACCESS_TOKEN`. Une revue humaine reste obligatoire avant qu'un lot devienne des données Gold annotables.
- **`v6-inventory-legacy-authority.mjs`** — scanne `src/`, `supabase/functions/` et `supabase/migrations/` pour recenser les résidus d'appel à l'ancien moteur relationnel (score-batch legacy, tables de scores dépréciées) et écrit un inventaire JSON (par défaut dans `docs/audits/`).
- **`v6-rebuild-isolated.py`** — rejoue les migrations et tests SQL dans un Postgres Supabase jetable et hors-ligne, pour vérifier la reproductibilité du schéma depuis Git sans jamais toucher au projet lié.
