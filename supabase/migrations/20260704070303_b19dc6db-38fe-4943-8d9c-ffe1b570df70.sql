
-- Storage: restrict approver INSERT on documents bucket to stamped_* files
DROP POLICY IF EXISTS "Approvers can upload stamped documents" ON storage.objects;
CREATE POLICY "Approvers can upload stamped documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
  AND (
    public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);

-- Storage: add UPDATE policy for documents bucket
DROP POLICY IF EXISTS "Documents bucket update policy" ON storage.objects;
CREATE POLICY "Documents bucket update policy"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
      AND (
        public.has_role(auth.uid(), 'HOD'::app_role)
        OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
        OR public.has_role(auth.uid(), 'IQA'::app_role)
      )
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
      AND (
        public.has_role(auth.uid(), 'HOD'::app_role)
        OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
        OR public.has_role(auth.uid(), 'IQA'::app_role)
      )
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role)
  )
);

-- Revoke public/anon execute on SECURITY DEFINER helpers; keep authenticated + service_role
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bootstrap_super_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(text) TO authenticated, service_role;
