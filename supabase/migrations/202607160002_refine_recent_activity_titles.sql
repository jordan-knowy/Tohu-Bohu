-- Affine les catégories à partir des contenus réellement importés.

create or replace function public.recent_activity_title(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_text, '') ~* '(nommé|nommée|nomination|désignation|promotion au|rejoint|prend la direction|devient)' then 'Nomination détectée'
    when coalesce(p_text, '') ~* '(retrait du poste|quitte|départ|démission|renonciation|cessation des fonctions|cesse ses fonctions)' then 'Départ de fonction'
    when coalesce(p_text, '') ~* '(levée|lève|capital|financement|investissement|investisseur|business angels?|revenus?)' then 'Évolution du financement'
    when coalesce(p_text, '') ~* '(partenariat|partenaire|collabore|collaboration|accord avec|adhésion)' then 'Nouveau partenariat'
    when coalesce(p_text, '') ~* '(acquisition|rachat|fusion|cession|liquidation|procédure collective)' then 'Opération stratégique'
    when coalesce(p_text, '') ~* '(lancement|lance|ouverture|nouvelle offre|offre spéciale|offre promotionnelle|product drop)' then 'Lancement d’une offre'
    when coalesce(p_text, '') ~* '(article|publication|publie|guide pratique)' then 'Nouvelle publication'
    when coalesce(p_text, '') ~* '(podcast|interview|prise de parole)' then 'Nouvelle prise de parole'
    when coalesce(p_text, '') ~* '(participation|salon|événement|event|conférence|webinaire|portes ouvertes|présence confirmée)' then 'Participation à un événement'
    when coalesce(p_text, '') ~* '(recrutement|recrute|embauche|poste à pourvoir)' then 'Recrutement détecté'
    when coalesce(p_text, '') ~* '(index égalité|équipe managériale|effectif|ressources humaines)' then 'Actualité RH'
    when coalesce(p_text, '') ~* '(réglement|obligation|arrêté|réforme|décret|loi|norme|entrée en vigueur|certificats d’économies d’énergie|cee)' then 'Évolution réglementaire'
    when coalesce(p_text, '') ~* '(email professionnel|coordonnées|adresse email)' then 'Coordonnées professionnelles mises à jour'
    when coalesce(p_text, '') ~* '(présence web|site web|site internet|réseaux sociaux)' then 'Présence en ligne détectée'
    when coalesce(p_text, '') ~* '(contrat|client|chiffre d''affaires|prospects?)' then 'Information commerciale'
    when coalesce(p_text, '') ~* '(prix|récompense|certification|agrément|label|statut de partenaire)' then 'Reconnaissance obtenue'
    when coalesce(p_text, '') ~* '(aucune activité|non disponible|n/a)' then 'Aucune actualité vérifiée'
    else 'Actualité récente'
  end
$$;

update public.behavioral_signals
set inference = public.recent_activity_title(text)
where signal_type = 'recent_activity';
