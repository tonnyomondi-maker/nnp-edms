
CREATE POLICY "Templates readable by any signed-in user"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'templates');

CREATE POLICY "Super Admin writes templates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "Super Admin updates templates"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "Super Admin deletes templates"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));
