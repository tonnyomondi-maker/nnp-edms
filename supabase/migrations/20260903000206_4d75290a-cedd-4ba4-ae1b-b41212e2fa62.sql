GRANT DELETE ON public.documents TO authenticated;

CREATE POLICY "Remove documents with no attached file"
ON public.documents
FOR DELETE
TO authenticated
USING (
  gdrive_file_id IS NULL
  AND file_url IS NULL
  AND signed_file_url IS NULL
  AND (public.has_role(auth.uid(), 'SUPER_ADMIN') OR trainer_id = auth.uid())
);