-- The uploader stores documents under organization_id/transcripts/... .
-- Supabase Storage's managed schema must exist before application migrations.
-- Avoid casting untrusted path components to UUID (malformed paths simply deny).
DROP POLICY IF EXISTS "Org members can manage tohu-documents" ON storage.objects;
CREATE POLICY "Org members can manage tohu-documents" ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'tohu-documents' AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.organization_id::text = split_part(name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'tohu-documents' AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.organization_id::text = split_part(name, '/', 1)
  )
);
