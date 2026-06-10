
-- 1. audit_logs: restrict SELECT, drop INSERT policy
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Privileged roles can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN') OR public.has_role(auth.uid(), 'DP_ACADEMICS'));

-- 2. profiles: restrict SELECT to self + privileged roles
DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Privileged roles view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'SUPER_ADMIN')
    OR public.has_role(auth.uid(), 'DP_ACADEMICS')
    OR public.has_role(auth.uid(), 'HOD')
    OR public.has_role(auth.uid(), 'IQA')
  );

-- 3. user_roles: remove DP write privileges to prevent privilege escalation
DROP POLICY IF EXISTS "DP can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "DP can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "DP can delete roles" ON public.user_roles;

-- 4. storage.objects (documents bucket): drop broad policies
DROP POLICY IF EXISTS "Authenticated can write documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view documents" ON storage.objects;
-- (ownership-scoped policies remain: "Trainers can upload own documents",
--  "Trainers and approvers can read documents", "Approvers can upload stamped documents",
--  "Trainers can delete own documents")

-- 5. Remove documents table from realtime publication (not used by app)
ALTER PUBLICATION supabase_realtime DROP TABLE public.documents;

-- 6. Revoke EXECUTE on SECURITY DEFINER functions that should not be user-callable
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_document_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_role_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_department_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin(text) FROM anon, public;
-- has_role remains executable since RLS policies depend on it
