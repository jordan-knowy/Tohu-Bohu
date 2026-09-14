-- Bucket public pour les photos de profil utilisateur, envoyées directement
-- par le membre depuis la page Compte (contrairement à contact-avatars,
-- alimenté côté serveur par sync-google-photos).
-- Chemin des objets : <user_id>/<fichier> — chaque membre ne peut écrire que
-- dans son propre dossier (préfixe = auth.uid()).
do $$
begin
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('profile-avatars', 'profile-avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    -- Lecture publique (le bucket est public ; policy explicite pour clarté).
    execute 'drop policy if exists profile_avatars_public_read on storage.objects';
    execute $policy$
      create policy profile_avatars_public_read on storage.objects
      for select to public
      using (bucket_id = 'profile-avatars')
    $policy$;

    execute 'drop policy if exists profile_avatars_owner_insert on storage.objects';
    execute $policy$
      create policy profile_avatars_owner_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'profile-avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;

    execute 'drop policy if exists profile_avatars_owner_update on storage.objects';
    execute $policy$
      create policy profile_avatars_owner_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'profile-avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;

    execute 'drop policy if exists profile_avatars_owner_delete on storage.objects';
    execute $policy$
      create policy profile_avatars_owner_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'profile-avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  end if;
end
$$;

notify pgrst, 'reload schema';
