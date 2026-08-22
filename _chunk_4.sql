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
GRANT ALL ON public.system_settings TO service_role;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can READ the lock state (needed to enforce guards client-side)
DROP POLICY IF EXISTS "Authenticated can read lock" ON public.system_settings;
CREATE POLICY "Authenticated can read lock"
  ON public.system_settings FOR SELECT
  TO authenticated USING (TRUE);

-- Only Super Admin may write (edge functions use service role, bypassing RLS)
DROP POLICY IF EXISTS "Super Admin can update lock" ON public.system_settings;
CREATE POLICY "Super Admin can update lock"
  ON public.system_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super Admin can insert lock" ON public.system_settings;
CREATE POLICY "Super Admin can insert lock"
  ON public.system_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Seed the singleton row
INSERT INTO public.system_settings (id, lock_active) VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_system_settings_updated ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1. Storage: remove public-role policies on documents bucket
DROP POLICY IF EXISTS "Trainers can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Trainers can delete own documents" ON storage.objects;

CREATE POLICY "Trainers can delete own documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documents' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- 2. Lock document updates with a trigger
CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_owner boolean := (auth.uid() = OLD.trainer_id);
  is_super boolean := public.has_role(auth.uid(), 'SUPER_ADMIN');
BEGIN
  IF is_super THEN
    RETURN NEW;
  END IF;

  IF is_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('HOD_APPROVED','DP_APPROVED','ARCHIVED') THEN
      RAISE EXCEPTION 'Trainers cannot approve their own documents';
    END IF;
    RETURN NEW;
  END IF;

  -- Approvers: forbid mutating identity / payload / submission metadata
  IF NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.submission_type IS DISTINCT FROM OLD.submission_type
     OR NEW.department IS DISTINCT FROM OLD.department
     OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
     OR NEW.session_year IS DISTINCT FROM OLD.session_year
     OR NEW.session_term IS DISTINCT FROM OLD.session_term
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  THEN
    RAISE EXCEPTION 'Approvers may not modify document identity or payload fields';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF public.has_role(auth.uid(),'HOD') AND OLD.status = 'SUBMITTED'
       AND NEW.status IN ('HOD_APPROVED','REJECTED') THEN
      NULL;
    ELSIF public.has_role(auth.uid(),'DP_ACADEMICS') AND OLD.status = 'HOD_APPROVED'
       AND NEW.status IN ('DP_APPROVED','REJECTED') THEN
      NULL;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_document_update_trg ON public.documents;
CREATE TRIGGER guard_document_update_trg
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.guard_document_update();

REVOKE EXECUTE ON FUNCTION public.guard_document_update() FROM PUBLIC;

-- 3. role_change_audit: explicitly block all client writes
DROP POLICY IF EXISTS "Block client writes to role audit" ON public.role_change_audit;
CREATE POLICY "Block client writes to role audit"
ON public.role_change_audit AS RESTRICTIVE
FOR ALL TO authenticated, anon
USING (false) WITH CHECK (false);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_stamp_mode text NOT NULL DEFAULT 'IMAGE'