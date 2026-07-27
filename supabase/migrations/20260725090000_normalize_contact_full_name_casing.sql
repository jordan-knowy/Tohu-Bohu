-- Convention Personnes : prénom en casse titre, nom de famille en MAJUSCULES
-- (ex. « Maxime WEINSTEIN »). Gère aussi le format importé « NOM, Prénom »
-- (avant la virgule = nom, forcé en majuscules ; après = prénom, casse titre)
-- sans jamais réordonner ni supprimer un token — seule la casse change.
create or replace function public.format_person_full_name(value text)
returns text
language plpgsql
immutable
as $$
declare
  trimmed text := btrim(coalesce(value, ''));
  comma_pos int;
  before_comma text;
  after_comma text;
  words text[];
begin
  if trimmed = '' then
    return value;
  end if;

  comma_pos := position(',' in trimmed);
  if comma_pos > 0 then
    before_comma := btrim(substr(trimmed, 1, comma_pos - 1));
    after_comma := btrim(substr(trimmed, comma_pos + 1));
    return upper(before_comma) || ', ' || public.format_person_full_name(after_comma);
  end if;

  words := regexp_split_to_array(trimmed, '\s+');
  if array_length(words, 1) = 1 then
    return initcap(words[1]);
  end if;
  return initcap(words[1]) || ' ' || upper(array_to_string(words[2:array_length(words,1)], ' '));
end;
$$;

create or replace function public.normalize_contact_full_name()
returns trigger
language plpgsql
as $$
begin
  if new.full_name is not null then
    new.full_name := public.format_person_full_name(new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_contact_full_name on public.contacts;
create trigger trg_normalize_contact_full_name
  before insert or update of full_name on public.contacts
  for each row execute function public.normalize_contact_full_name();

-- Backfill : aligne les noms déjà en base sur la convention (n'écrit que les
-- lignes qui changent réellement).
update public.contacts
set full_name = public.format_person_full_name(full_name)
where full_name is not null
  and full_name <> public.format_person_full_name(full_name);
