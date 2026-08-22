DROP TRIGGER IF EXISTS trg_protect_stamp_dates ON UPDATE;
CREATE TRIGGER trg_protect_stamp_dates
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.protect_stamp_dates();

-- 5. SUPER_ADMIN write policies on user_roles (DP already has; add SA mirror just in case)
-- (Already exist per schema dump; no-op safety)

-- 6. SUPER_ADMIN can update/insert profiles (already allowed update; ensure insert)
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
CREATE POLICY "Super admins can insert any profile" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Storage policies: backups bucket — Super Admin only
DROP POLICY IF EXISTS "Super admins read backups" ON storage.objects;
CREATE POLICY "Super admins read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins write backups" ON storage.objects;
CREATE POLICY "Super admins write backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins update backups" ON storage.objects;
CREATE POLICY "Super admins update backups"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins delete backups" ON storage.objects;
CREATE POLICY "Super admins delete backups"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Google Drive mirror fields on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_file_id text,
  ADD COLUMN IF NOT EXISTS gdrive_web_view_link text;

-- Backup metadata table
CREATE TABLE IF NOT EXISTS public.backup_metadata (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  documents_count integer DEFAULT 0,
  audit_logs_count integer DEFAULT 0,
  storage_files_count integer DEFAULT 0,
  total_bytes bigint DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_metadata TO authenticated;
GRANT ALL ON public.backup_metadata TO service_role;

ALTER TABLE public.backup_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage backup metadata" ON public.backup_metadata;
CREATE POLICY "Super admins manage backup metadata"
ON public.backup_metadata FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- 1. audit_logs: restrict SELECT, drop INSERT policy
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated can insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Privileged roles can view audit logs" ON public.audit_logs;
CREATE POLICY "Privileged roles can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN') OR public.has_role(auth.uid(), 'DP_ACADEMICS'));

-- 2. profiles: restrict SELECT to self + privileged roles
DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Privileged roles view all profiles" ON public.profiles;
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


DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users read own signatures" ON storage.objects;
CREATE POLICY "Users read own signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND (auth.uid())::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Privileged roles read all signatures" ON storage.objects;
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

-- 1. system_settings singleton table for the Super Admin safety lock
CREATE TABLE IF NOT EXISTS public.system_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lock_active BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason TEXT,
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  locked_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_settings TO authenticated;