-- Make documents bucket public so getPublicUrl returns a working URL
UPDATE storage.buckets SET public = true WHERE id = 'documents';

-- Ensure read access policy exists for documents bucket
DROP POLICY IF EXISTS "Anyone can read documents bucket" ON storage.objects;
CREATE POLICY "Anyone can read documents bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

-- Trainers can upload to their own folder (user_id prefix)
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
CREATE POLICY "Trainers can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service role / approvers can write stamped versions (edge function uses service role)
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;
CREATE POLICY "Authenticated can upload to documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');