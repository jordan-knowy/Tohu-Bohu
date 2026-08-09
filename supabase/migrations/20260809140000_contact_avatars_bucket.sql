-- Bucket public pour les photos de profil des contacts, auto-hébergées depuis
-- Google People par l'edge function sync-google-photos (service_role).
--
-- Pourquoi auto-héberger plutôt que pointer directement sur googleusercontent.com :
--  - fiabilité : les URLs Google peuvent expirer / être limitées → image cassée ;
--  - vie privée : évite que le navigateur de chaque membre appelle Google
--    (fuite d'IP / referer) à chaque affichage de la liste Personnes ;
--  - cohérence : même approche que les logos d'organisation (bucket `branding`).
-- Chemin des objets : <organization_id>/<contact_id>.<ext> (UUID non devinables).
do $$
begin
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('contact-avatars', 'contact-avatars', true)
    on conflict (id) do update set public = true;

    -- Lecture publique (le bucket est public ; policy explicite pour clarté).
    execute 'drop policy if exists contact_avatars_public_read on storage.objects';
    execute $policy$
      create policy contact_avatars_public_read on storage.objects
      for select to public
      using (bucket_id = 'contact-avatars')
    $policy$;
  end if;
end
$$;

notify pgrst, 'reload schema';
