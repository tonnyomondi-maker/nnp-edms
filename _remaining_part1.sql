
-- Drop overly permissive audit_logs insert policy
DROP POLICY "System can insert audit logs" ON public.audit_logs;

-- The audit log trigger uses SECURITY DEFINER so it bypasses RLS.
-- No insert policy needed for regular users - only triggers insert.

-- Drop duplicate permissive user_roles policy
DROP POLICY "Admins can view all roles" ON public.user_roles;
-- Create storage bucket for document PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- Trainers can upload to their own folder
CREATE POLICY "Trainers can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view documents in their department or their own
CREATE POLICY "Authenticated users can view documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents'
  AND auth.role() = 'authenticated'
);

-- Trainers can delete their own uploads (for re-upload on rejection)
CREATE POLICY "Trainers can delete own documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
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
-- Profile signature & stamp
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS stamp_url TEXT;

-- Document approval signature/stamp tracking
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS hod_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS hod_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS hod_approved_by UUID,
  ADD COLUMN IF NOT EXISTS dp_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS dp_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS dp_approved_by UUID,
  ADD COLUMN IF NOT EXISTS iqa_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS iqa_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS iqa_archived_by UUID,
  ADD COLUMN IF NOT EXISTS signed_file_url TEXT;

-- Public signatures bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', true)
ON CONFLICT (id) DO NOTHING;

-- RLS for signatures bucket
DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;
CREATE POLICY "Signatures are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Users upload own signatures" ON storage.objects;
CREATE POLICY "Users upload own signatures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users update own signatures" ON storage.objects;
CREATE POLICY "Users update own signatures"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users delete own signatures" ON storage.objects;
CREATE POLICY "Users delete own signatures"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Make documents bucket files readable by approvers (so edge function can fetch via service role - already covered, but ensure read for authenticated)
DROP POLICY IF EXISTS "Authenticated can read documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can read documents bucket"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "Authenticated can write documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can write documents bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "Authenticated can update documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can update documents bucket"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'documents');ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS hod_sig_page integer,
  ADD COLUMN IF NOT EXISTS hod_sig_x numeric,
  ADD COLUMN IF NOT EXISTS hod_sig_y numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_page integer,
  ADD COLUMN IF NOT EXISTS hod_stamp_x numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_y numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_page integer,
  ADD COLUMN IF NOT EXISTS dp_sig_x numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_y numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_page integer,
  ADD COLUMN IF NOT EXISTS dp_stamp_x numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_y numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_page integer,
  ADD COLUMN IF NOT EXISTS iqa_sig_x numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_y numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_page integer,
  ADD COLUMN IF NOT EXISTS iqa_stamp_x numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_y numeric;-- Add EXPORTED status to enum
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'EXPORTED';

-- Add export tracking columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_by UUID;

CREATE INDEX IF NOT EXISTS idx_documents_archived_at ON public.documents(archived_at);
CREATE INDEX IF NOT EXISTS idx_documents_exported_at ON public.documents(exported_at);-- 1. Documents: make assignment_id nullable + add session/unit fields
ALTER TABLE public.documents 
  ALTER COLUMN assignment_id DROP NOT NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS unit_name TEXT,
  ADD COLUMN IF NOT EXISTS class_code TEXT,
  ADD COLUMN IF NOT EXISTS session_year INT,
  ADD COLUMN IF NOT EXISTS session_term TEXT,
  ADD COLUMN IF NOT EXISTS sessions_per_week INT,
  ADD COLUMN IF NOT EXISTS session_index INT;

-- Backfill session_year / session_term from submitted_at for legacy rows
UPDATE public.documents
SET 
  session_year = EXTRACT(YEAR FROM submitted_at)::INT,
  session_term = CASE
    WHEN EXTRACT(MONTH FROM submitted_at) BETWEEN 1 AND 4 THEN 'JAN_APR'
    WHEN EXTRACT(MONTH FROM submitted_at) BETWEEN 5 AND 8 THEN 'MAY_AUG'
    ELSE 'SEP_DEC'
  END
WHERE session_year IS NULL OR session_term IS NULL;

-- Backfill denormalized unit info from teaching_assignments where present
UPDATE public.documents d
SET 
  unit_code = COALESCE(d.unit_code, ta.unit_code),
  unit_name = COALESCE(d.unit_name, ta.unit_name),
  class_code = COALESCE(d.class_code, ta.class_code)
FROM public.teaching_assignments ta
WHERE d.assignment_id = ta.id
  AND (d.unit_code IS NULL OR d.unit_name IS NULL OR d.class_code IS NULL);

-- Validation: ensure session_term is one of the allowed values
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_session_term_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_session_term_check
  CHECK (session_term IS NULL OR session_term IN ('JAN_APR', 'MAY_AUG', 'SEP_DEC'));

-- 2. New table: unit_session_config
CREATE TABLE IF NOT EXISTS public.unit_session_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trainer_id UUID NOT NULL,
  department TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  unit_name TEXT,
  class_code TEXT,
  session_year INT NOT NULL,
  session_term TEXT NOT NULL CHECK (session_term IN ('JAN_APR', 'MAY_AUG', 'SEP_DEC')),
  sessions_per_week INT NOT NULL DEFAULT 1 CHECK (sessions_per_week BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, unit_code, session_year, session_term)
);

ALTER TABLE public.unit_session_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers manage own unit configs"
  ON public.unit_session_config
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "HOD/DP/IQA can view unit configs"
  ON public.unit_session_config
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'HOD'::app_role)
    OR has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR has_role(auth.uid(), 'IQA'::app_role)
  );

CREATE TRIGGER update_unit_session_config_updated_at
  BEFORE UPDATE ON public.unit_session_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_documents_session 
  ON public.documents(session_year, session_term);
CREATE INDEX IF NOT EXISTS idx_documents_unit_code 
  ON public.documents(unit_code);ALTER TABLE public.unit_session_config ADD COLUMN IF NOT EXISTS term_number INTEGER CHECK (term_number BETWEEN 1 AND 3);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS term_number INTEGER CHECK (term_number BETWEEN 1 AND 3);
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN ('trainer@test.com','hod@test.com','dp@test.com','iqa@test.com');

UPDATE public.profiles SET department = 'Computer Science', pf_number = 'PF-TRAINER' WHERE email = 'trainer@test.com';
UPDATE public.profiles SET department = 'Computer Science', pf_number = 'PF-HOD' WHERE email = 'hod@test.com';
UPDATE public.profiles SET department = 'Academics', pf_number = 'PF-DP' WHERE email = 'dp@test.com';
UPDATE public.profiles SET department = 'Quality Assurance', pf_number = 'PF-IQA' WHERE email = 'iqa@test.com';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'TRAINER'::app_role FROM auth.users WHERE email = 'trainer@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'HOD'::app_role FROM auth.users WHERE email = 'hod@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'DP_ACADEMICS'::app_role FROM auth.users WHERE email = 'dp@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'IQA'::app_role FROM auth.users WHERE email = 'iqa@test.com'
ON CONFLICT DO NOTHING;
-- 1. Add 'Course Outline' to document_type enum
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'Course Outline';

-- 2. Add course_type + module_number to unit_session_config
ALTER TABLE public.unit_session_config
  ADD COLUMN IF NOT EXISTS course_type text NOT NULL DEFAULT 'CYCLE',
  ADD COLUMN IF NOT EXISTS module_number integer;

-- 3. Add course_type + module_number to documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS course_type text,
  ADD COLUMN IF NOT EXISTS module_number integer;

-- 4. Validation trigger: enforce course_type/module/term combinations
CREATE OR REPLACE FUNCTION public.validate_course_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.course_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.course_type NOT IN ('CYCLE','MODULAR') THEN
    RAISE EXCEPTION 'course_type must be CYCLE or MODULAR';
  END IF;
  IF NEW.course_type = 'MODULAR' THEN
    IF NEW.module_number IS NULL OR NEW.module_number < 1 OR NEW.module_number > 8 THEN
      RAISE EXCEPTION 'module_number 1-8 required for MODULAR course';
    END IF;
  ELSIF NEW.course_type = 'CYCLE' THEN
    IF NEW.module_number IS NOT NULL THEN
      NEW.module_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_course_stage_unit ON public.unit_session_config;
CREATE TRIGGER trg_validate_course_stage_unit
  BEFORE INSERT OR UPDATE ON public.unit_session_config
  FOR EACH ROW EXECUTE FUNCTION public.validate_course_stage();

DROP TRIGGER IF EXISTS trg_validate_course_stage_doc ON public.documents;
CREATE TRIGGER trg_validate_course_stage_doc
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_course_stage();

-- 5. Tighten HOD RLS to department-scoped only
DROP POLICY IF EXISTS "HOD can view department documents" ON public.documents;
DROP POLICY IF EXISTS "HOD can update document status" ON public.documents;

CREATE POLICY "HOD can view own department documents"
  ON public.documents FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'HOD'::app_role)
    AND department = (SELECT department FROM public.profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "HOD can update own department documents"
  ON public.documents FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'HOD'::app_role)
    AND department = (SELECT department FROM public.profiles WHERE user_id = auth.uid())
  );
-- Make documents bucket public so getPublicUrl returns a working URL
UPDATE storage.buckets SET public = true WHERE id = 'documents';

-- Ensure read access policy exists for documents bucket
DROP POLICY IF EXISTS "Anyone can read documents bucket" ON storage.objects;
CREATE POLICY "Anyone can read documents bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

-- Trainers can upload to their own folder (user_id prefix)
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
CREATE POLICY "Trainers can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service role / approvers can write stamped versions (edge function uses service role)
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;
CREATE POLICY "Authenticated can upload to documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');-- Make documents bucket private (use signed URLs everywhere)
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- Drop overly-broad SELECT policies from previous migration
DROP POLICY IF EXISTS "Anyone can read documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;

-- Trainers (and all approvers) can read PDFs they have business access to.
-- Storage objects don't carry document metadata, so we authorize via storage path:
--   <trainer_user_id>/...  for original uploads
--   <trainer_user_id>/<assignment_or_session>/stamped_*.pdf  for approved versions
-- Anyone authenticated who is a HOD/DP/IQA OR the owning trainer can read.
DROP POLICY IF EXISTS "Trainers and approvers can read documents" ON storage.objects;
CREATE POLICY "Trainers and approvers can read documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND (
    -- Owning trainer (folder name = their user_id)
    auth.uid()::text = (storage.foldername(name))[1]
    -- Or any approver role can read for review/archive
    OR public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);

-- Keep / re-create trainer upload policy
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
CREATE POLICY "Trainers can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Approvers can upload stamped versions (HOD/DP/IQA write into the trainer's folder via service role,
-- but if any approval call ever runs through user JWT, allow it explicitly too)
DROP POLICY IF EXISTS "Approvers can upload stamped documents" ON storage.objects;
CREATE POLICY "Approvers can upload stamped documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND (
    public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'SUPER_ADMIN'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'SUPER_ADMIN';
  END IF;
END$$;-- 1. Allow modules 1-10
CREATE OR REPLACE FUNCTION public.validate_course_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.course_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.course_type NOT IN ('CYCLE','MODULAR') THEN
    RAISE EXCEPTION 'course_type must be CYCLE or MODULAR';
  END IF;
  IF NEW.course_type = 'MODULAR' THEN
    IF NEW.module_number IS NULL OR NEW.module_number < 1 OR NEW.module_number > 10 THEN
      RAISE EXCEPTION 'module_number 1-10 required for MODULAR course';
    END IF;
  ELSIF NEW.course_type = 'CYCLE' THEN
    IF NEW.module_number IS NOT NULL THEN
      NEW.module_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS hod_sig_w numeric,
  ADD COLUMN IF NOT EXISTS hod_sig_h numeric,
  ADD COLUMN IF NOT EXISTS hod_sig_rot integer,
  ADD COLUMN IF NOT EXISTS hod_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS hod_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS hod_autofill boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS dp_sig_w numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_h numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_rot integer,
  ADD COLUMN IF NOT EXISTS dp_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS dp_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS dp_autofill boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS iqa_sig_w numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_h numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_rot integer,
  ADD COLUMN IF NOT EXISTS iqa_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS iqa_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS iqa_autofill boolean DEFAULT true;

DROP POLICY IF EXISTS "Super admins can view all roles" ON public.user_roles;
CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can insert roles" ON public.user_roles;
CREATE POLICY "Super admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update roles" ON public.user_roles;
CREATE POLICY "Super admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can delete roles" ON public.user_roles;
CREATE POLICY "Super admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update any profile" ON public.profiles;
CREATE POLICY "Super admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));
CREATE TABLE IF NOT EXISTS public.role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_user_id uuid NOT NULL,
  target_email text,
  target_name text,
  action text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_email text
);

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins view role audit" ON public.role_change_audit
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role) OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
  actor_email text;
BEGIN
  SELECT email, full_name INTO p FROM public.profiles WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) LIMIT 1;
  SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, p.email, p.full_name, 'ROLE_ADDED', NEW.role::text, auth.uid(), actor_email);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, changed_by, changed_by_email)
    VALUES (OLD.user_id, p.email, p.full_name, 'ROLE_REMOVED', OLD.role::text, auth.uid(), actor_email);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

CREATE OR REPLACE FUNCTION public.log_department_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_email text;
BEGIN
  IF OLD.department IS DISTINCT FROM NEW.department THEN
    SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, NEW.email, NEW.full_name, 'DEPARTMENT_CHANGED', OLD.department, NEW.department, auth.uid(), actor_email);
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();

CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count int;
  target_uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  SELECT count(*) INTO existing_count FROM public.user_roles WHERE role = 'SUPER_ADMIN';
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Super Admin already configured';
  END IF;
  SELECT user_id INTO target_uid FROM public.profiles WHERE lower(email) = lower(target_email) LIMIT 1;
  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %', target_email;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_uid, 'SUPER_ADMIN')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('user_id', target_uid, 'email', target_email);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_super_admin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(text) TO authenticated;

-- Ensure the role_change_audit table exists (idempotent)
CREATE TABLE IF NOT EXISTS public.role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_user_id uuid NOT NULL,
  target_email text,
  target_name text,
  action text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_email text
);

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

-- Ensure the audit log policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_change_audit'
      AND policyname = 'Super admins view role audit'
  ) THEN
    CREATE POLICY "Super admins view role audit" ON public.role_change_audit
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role) OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));
  END IF;
END $$;

-- Recreate the role change trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
  actor_email text;
BEGIN
  SELECT email, full_name INTO p FROM public.profiles WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) LIMIT 1;
  SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, p.email, p.full_name, 'ROLE_ADDED', NEW.role::text, auth.uid(), actor_email);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, changed_by, changed_by_email)
    VALUES (OLD.user_id, p.email, p.full_name, 'ROLE_REMOVED', OLD.role::text, auth.uid(), actor_email);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

-- Recreate the department change trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.log_department_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_email text;
BEGIN
  IF OLD.department IS DISTINCT FROM NEW.department THEN
    SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, NEW.email, NEW.full_name, 'DEPARTMENT_CHANGED', OLD.department, NEW.department, auth.uid(), actor_email);
  END IF;
  RETURN NEW;
END;$$;

-- Create triggers if they don't exist
DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();

DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();
CREATE POLICY "Authenticated can insert own audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (performed_by = auth.uid());

GRANT INSERT ON public.audit_logs TO authenticated;
-- 1. Pin SUPER_ADMIN bootstrap to tonny.omondi@nyamirapoly.ac.ke
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count int;
  target_uid uuid;
  allowed_email constant text := 'tonny.omondi@nyamirapoly.ac.ke';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF lower(target_email) <> allowed_email THEN
    RAISE EXCEPTION 'Only % may be promoted to Super Admin', allowed_email;
  END IF;
  SELECT count(*) INTO existing_count FROM public.user_roles WHERE role = 'SUPER_ADMIN';
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Super Admin already configured';
  END IF;
  SELECT user_id INTO target_uid FROM public.profiles WHERE lower(email) = allowed_email LIMIT 1;
  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'No user with email % — that account must sign up first', allowed_email;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_uid, 'SUPER_ADMIN')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('user_id', target_uid, 'email', allowed_email);
END;
$$;

-- 2. handle_new_user: write department + pf_number + default TRAINER role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, department, pf_number)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    NULLIF(NEW.raw_user_meta_data->>'department', ''),
    NULLIF(NEW.raw_user_meta_data->>'pf_number', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'TRAINER')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. is_test_user column on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test_user boolean NOT NULL DEFAULT false;

-- 4. Consistent stamp date fields
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS verified_by_hod_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_by_dp_academics_at timestamptz;

-- Backfill from legacy columns
UPDATE public.documents SET verified_by_hod_at = hod_approved_at WHERE verified_by_hod_at IS NULL AND hod_approved_at IS NOT NULL;
UPDATE public.documents SET approved_by_dp_academics_at = dp_approved_at WHERE approved_by_dp_academics_at IS NULL AND dp_approved_at IS NOT NULL;

-- Immutability trigger: once set, may not be changed
CREATE OR REPLACE FUNCTION public.protect_stamp_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.verified_by_hod_at IS NOT NULL AND NEW.verified_by_hod_at IS DISTINCT FROM OLD.verified_by_hod_at THEN
    NEW.verified_by_hod_at := OLD.verified_by_hod_at;
  END IF;
  IF OLD.approved_by_dp_academics_at IS NOT NULL AND NEW.approved_by_dp_academics_at IS DISTINCT FROM OLD.approved_by_dp_academics_at THEN
    NEW.approved_by_dp_academics_at := OLD.approved_by_dp_academics_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_stamp_dates ON public.documents;
CREATE TRIGGER trg_protect_stamp_dates
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.protect_stamp_dates();

-- 5. SUPER_ADMIN write policies on user_roles (DP already has; add SA mirror just in case)
-- (Already exist per schema dump; no-op safety)

-- 6. SUPER_ADMIN can update/insert profiles (already allowed update; ensure insert)
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
CREATE POLICY "Super admins can insert any profile" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));
-- Storage policies: backups bucket — Super Admin only
CREATE POLICY "Super admins read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins write backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins update backups"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins delete backups"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Google Drive mirror fields on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_file_id text,
  ADD COLUMN IF NOT EXISTS gdrive_web_view_link text;

-- Backup metadata table
CREATE TABLE public.backup_metadata (
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

CREATE POLICY "Super admins manage backup metadata"
ON public.backup_metadata FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));
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
    CHECK (preferred_stamp_mode IN ('IMAGE','TEXT_ONLY')),
  ADD COLUMN IF NOT EXISTS stamp_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_sig_w numeric,
  ADD COLUMN IF NOT EXISTS default_sig_h numeric,
  ADD COLUMN IF NOT EXISTS default_sig_rot numeric,
  ADD COLUMN IF NOT EXISTS default_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_rot numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_opacity numeric;
CREATE TABLE public.document_type_policy (
  document_type public.document_type PRIMARY KEY,
  signature_only_allowed boolean NOT NULL DEFAULT false,
  stamp_required boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_type_policy TO authenticated;
GRANT ALL ON public.document_type_policy TO service_role;

ALTER TABLE public.document_type_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read approval policies"
  ON public.document_type_policy FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super Admin can insert policies"
  ON public.document_type_policy FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super Admin can update policies"
  ON public.document_type_policy FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super Admin can delete policies"
  ON public.document_type_policy FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER document_type_policy_updated_at
  BEFORE UPDATE ON public.document_type_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed defaults: weekly docs allow signature-only; one-time formal docs require stamp.
INSERT INTO public.document_type_policy (document_type, signature_only_allowed, stamp_required, notes) VALUES
  ('Class Attendance',     true,  false, 'Weekly attendance — signature alone is sufficient.'),
  ('Session Plan',         true,  false, 'Weekly session plan — signature alone is sufficient.'),
  ('Learning Plan',        false, true,  'One-time formal document — stamp required.'),
  ('Personal Timetable',   false, true,  'One-time formal document — stamp required.'),
  ('Workload Allocation',  false, true,  'One-time formal document — stamp required.'),
  ('Scheme of Work',       false, true,  'One-time formal document — stamp required.'),
  ('Course Outline',       false, true,  'One-time formal document — stamp required.')
ON CONFLICT (document_type) DO NOTHING;
-- Storage: restrict approver INSERT on documents bucket to stamped_* files
DROP POLICY IF EXISTS "Approvers can upload stamped documents" ON storage.objects;
CREATE POLICY "Approvers can upload stamped documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
  AND (
    public.has_role(auth.uid(), 'HOD'::app_role)
    OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR public.has_role(auth.uid(), 'IQA'::app_role)
  )
);

-- Storage: add UPDATE policy for documents bucket
DROP POLICY IF EXISTS "Documents bucket update policy" ON storage.objects;
CREATE POLICY "Documents bucket update policy"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
      AND (
        public.has_role(auth.uid(), 'HOD'::app_role)
        OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
        OR public.has_role(auth.uid(), 'IQA'::app_role)
      )
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE 'stamped\_%' ESCAPE '\'
      AND (
        public.has_role(auth.uid(), 'HOD'::app_role)
        OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
        OR public.has_role(auth.uid(), 'IQA'::app_role)
      )
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role)
  )
);

-- Revoke public/anon execute on SECURITY DEFINER helpers; keep authenticated + service_role
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bootstrap_super_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(text) TO authenticated, service_role;
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS gdrive_last_error text,
  ADD COLUMN IF NOT EXISTS gdrive_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS gdrive_attempt_count integer NOT NULL DEFAULT 0;

UPDATE public.documents SET gdrive_sync_status = 'success' WHERE gdrive_file_id IS NOT NULL AND gdrive_sync_status <> 'success';
-- 1) Forbid text-only fallback per doc type
ALTER TABLE public.document_type_policy
  ADD COLUMN IF NOT EXISTS forbid_text_only_fallback boolean NOT NULL DEFAULT false;

-- 2) Verification packs shared with external verifiers
CREATE TABLE IF NOT EXISTS public.verification_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  session_year int NOT NULL,
  session_term text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  download_count int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.verification_packs TO authenticated;
GRANT ALL ON public.verification_packs TO service_role;

ALTER TABLE public.verification_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IQA and SuperAdmin can view packs"
  ON public.verification_packs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "IQA and SuperAdmin can create packs"
  ON public.verification_packs FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
    AND created_by = auth.uid()
  );

CREATE POLICY "IQA and SuperAdmin can revoke packs"
  ON public.verification_packs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER update_verification_packs_updated_at
  BEFORE UPDATE ON public.verification_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_verification_packs_dept_session
  ON public.verification_packs(department, session_year, session_term);

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
