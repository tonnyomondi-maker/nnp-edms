
-- 1) SECURITY DEFINER trigger function should not be callable via the API
REVOKE ALL ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;

-- 2) Tighten stamped-file storage policies: caller must be an approver for a
-- real document in their own department, at the correct approval stage.
CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.profiles p ON p.user_id = auth.uid()
    WHERE d.department = p.department
      AND (
        (public.has_role(auth.uid(), 'HOD')          AND d.status = 'SUBMITTED')
        OR (public.has_role(auth.uid(), 'DP_ACADEMICS') AND d.status = 'HOD_APPROVED')
        OR (public.has_role(auth.uid(), 'IQA')          AND d.status = 'DP_APPROVED')
      )
      AND (
        d.file_url        LIKE '%' || _path
        OR d.signed_file_url LIKE '%' || _path
        OR _path LIKE '%' || d.id::text || '%'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_stamp_document_file(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_stamp_document_file(text) TO authenticated;

DROP POLICY IF EXISTS "Approvers can upload stamped documents" ON storage.objects;
CREATE POLICY "Approvers can upload stamped documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND storage.filename(name) LIKE like_escape('stamped\_%', '\')
  AND (
    public.has_role(auth.uid(), 'HOD')
    OR public.has_role(auth.uid(), 'DP_ACADEMICS')
    OR public.has_role(auth.uid(), 'IQA')
  )
  AND public.can_stamp_document_file(name)
);

DROP POLICY IF EXISTS "Documents bucket update policy" ON storage.objects;
CREATE POLICY "Documents bucket update policy"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE like_escape('stamped\_%', '\')
      AND (
        public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'IQA')
      )
      AND public.can_stamp_document_file(name)
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE like_escape('stamped\_%', '\')
      AND (
        public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'IQA')
      )
      AND public.can_stamp_document_file(name)
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
);
