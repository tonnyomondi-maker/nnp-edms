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
