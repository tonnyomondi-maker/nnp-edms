CREATE OR REPLACE FUNCTION public.is_portal_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;
REVOKE ALL ON FUNCTION public.is_portal_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_portal_member(uuid) TO authenticated;

DROP POLICY "Authenticated can read courses" ON public.courses;
CREATE POLICY "Portal members can read courses" ON public.courses FOR SELECT TO authenticated USING (public.is_portal_member(auth.uid()));
DROP POLICY "Anyone signed in can read sessions" ON public.academic_sessions;
CREATE POLICY "Portal members can read sessions" ON public.academic_sessions FOR SELECT TO authenticated USING (public.is_portal_member(auth.uid()));
DROP POLICY "Signed-in users can read stamp layouts" ON public.stamp_layouts;
CREATE POLICY "Portal members can read stamp layouts" ON public.stamp_layouts FOR SELECT TO authenticated USING (public.is_portal_member(auth.uid()));
DROP POLICY "Authenticated can read approval policies" ON public.document_type_policy;
CREATE POLICY "Portal members can read approval policies" ON public.document_type_policy FOR SELECT TO authenticated USING (public.is_portal_member(auth.uid()));
DROP POLICY "Templates readable by any signed-in user" ON storage.objects;
CREATE POLICY "Templates readable by portal members" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'templates' AND public.is_portal_member(auth.uid()));