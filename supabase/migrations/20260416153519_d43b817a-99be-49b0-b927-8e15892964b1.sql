
-- DP_ACADEMICS can view all user roles
CREATE POLICY "DP can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can insert roles
CREATE POLICY "DP can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can update roles
CREATE POLICY "DP can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can delete roles
CREATE POLICY "DP can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can insert teaching assignments
CREATE POLICY "DP can insert assignments"
ON public.teaching_assignments
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can update teaching assignments
CREATE POLICY "DP can update assignments"
ON public.teaching_assignments
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can delete teaching assignments
CREATE POLICY "DP can delete assignments"
ON public.teaching_assignments
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));
