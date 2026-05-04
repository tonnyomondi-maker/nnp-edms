-- Make documents bucket private (use signed URLs everywhere)
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- Drop overly-broad SELECT policies from previous migration
DROP POLICY IF EXISTS "Anyone can read documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;

-- Trainers (and all approvers) can read PDFs they have business access to.
-- Storage objects don't carry document metadata, so we authorize via storage path:
--   <trainer_user_id>/...  for original uploads
--   <trainer_user_id>/<assignment_or_session>/stamped_*.pdf  for approved versions
-- Anyone authenticated who is a HOD/DP/IQA OR the owning trainer can read.
DROP POLICY IF EXISTS "Trainers and approvers can read documents" ON storage.objects;
CREATE POLICY "Trainers and approvers can read documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND (
    -- Owning trainer (folder name = their user_id)
    auth.uid()::text = (storage.foldername(name))[1]
    -- Or any approver role can read for review/archive
    OR public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);

-- Keep / re-create trainer upload policy
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
CREATE POLICY "Trainers can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Approvers can upload stamped versions (HOD/DP/IQA write into the trainer's folder via service role,
-- but if any approval call ever runs through user JWT, allow it explicitly too)
DROP POLICY IF EXISTS "Approvers can upload stamped documents" ON storage.objects;
CREATE POLICY "Approvers can upload stamped documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND (
    public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);