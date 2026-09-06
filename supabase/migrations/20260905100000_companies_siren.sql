-- SIREN saisi/confirmé par un humain sur le compte, sert de clé pour l'enrichissement
-- registre (INSEE Sirene + INPI RNE) — jamais déduit automatiquement d'un nom d'entreprise
-- (ambiguïté possible), toujours un identifiant exact fourni par l'utilisateur.
alter table public.companies add column if not exists siren text;
alter table public.companies add constraint companies_siren_format check (siren is null or siren ~ '^[0-9]{9}$');
