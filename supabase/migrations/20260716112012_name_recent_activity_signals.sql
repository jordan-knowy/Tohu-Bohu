-- Donne un titre métier aux signaux importés sous le code technique
-- `recent_activity`. La règle s'applique aux données existantes et futures.

create or replace function public.recent_activity_title(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_text, '') ~* '\m(nommé|nommée|nomination|rejoint|prend la direction|devient)\M' then 'Nomination détectée'
    when coalesce(p_text, '') ~* '(retrait du poste|quitte|départ|cesse ses fonctions)' then 'Départ de fonction'
    when coalesce(p_text, '') ~* '\m(levée|capital|financement|investisseur|business angels?)\M' then 'Évolution du financement'
    when coalesce(p_text, '') ~* '\m(partenariat|partenaire|collabore|collaboration)\M' then 'Nouveau partenariat'
    when coalesce(p_text, '') ~* '\m(acquisition|rachat|fusion)\M' then 'Opération stratégique'
    when coalesce(p_text, '') ~* '(lancement|lance|nouvelle offre|offre spéciale|offre promotionnelle)' then 'Lancement d’une offre'
    when coalesce(p_text, '') ~* '\m(article|publication|publie)\M|guide pratique' then 'Nouvelle publication'
    when coalesce(p_text, '') ~* '\m(podcast|interview)\M|prise de parole' then 'Nouvelle prise de parole'
    when coalesce(p_text, '') ~* '\m(salon|événement|event|conférence|webinaire)\M|présence confirmée' then 'Participation à un événement'
    when coalesce(p_text, '') ~* '\m(recrutement|recrute|embauche)\M|poste à pourvoir' then 'Recrutement détecté'
    when coalesce(p_text, '') ~* '(index égalité|équipe managériale|effectif|ressources humaines)' then 'Actualité RH'
    when coalesce(p_text, '') ~* '\m(réglement|obligation|décret|loi|norme)\M' then 'Évolution réglementaire'
    when coalesce(p_text, '') ~* '(email professionnel|coordonnées|adresse email)' then 'Coordonnées professionnelles mises à jour'
    when coalesce(p_text, '') ~* '(présence web|site web|site internet)' then 'Présence en ligne détectée'
    when coalesce(p_text, '') ~* '\m(contrat|client|revenu)\M|chiffre d''affaires' then 'Information commerciale'
    when coalesce(p_text, '') ~* '\m(prix|récompense|certification|label)\M|statut de partenaire' then 'Reconnaissance obtenue'
    else 'Actualité récente'
  end
$$;

create or replace function public.name_recent_activity_signal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.signal_type = 'recent_activity'
     and nullif(btrim(coalesce(new.inference, '')), '') is null then
    new.inference := public.recent_activity_title(new.text);
  end if;
  return new;
end;
$$;

drop trigger if exists name_recent_activity_signal on public.behavioral_signals;
create trigger name_recent_activity_signal
before insert or update of signal_type, text, inference
on public.behavioral_signals
for each row execute function public.name_recent_activity_signal();

update public.behavioral_signals
set inference = public.recent_activity_title(text)
where signal_type = 'recent_activity'
  and nullif(btrim(coalesce(inference, '')), '') is null;
