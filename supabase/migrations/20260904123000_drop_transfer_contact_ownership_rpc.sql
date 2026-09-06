-- La passation en liste (Comptes/Personnes) est reconstruite sur le modèle
-- de partage additif (share_fiche/fiche_shares, déjà utilisé fiche par fiche
-- — voir person-detail/service.ts sharePerson). Un vrai transfert exclusif
-- d'owner ne correspond plus à la logique produit : ce RPC devient inutile.
drop function if exists public.transfer_contact_ownership(uuid, uuid[], uuid);
