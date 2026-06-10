
DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;
CREATE POLICY "Users read own signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "Privileged roles read all signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures' AND (
      public.has_role(auth.uid(), 'SUPER_ADMIN')
      OR public.has_role(auth.uid(), 'DP_ACADEMICS')
      OR public.has_role(auth.uid(), 'HOD')
      OR public.has_role(auth.uid(), 'IQA')
    )
  );

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
