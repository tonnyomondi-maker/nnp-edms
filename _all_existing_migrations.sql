
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('TRAINER', 'HOD', 'DP_ACADEMICS', 'IQA');

-- Create document status enum
CREATE TYPE public.document_status AS ENUM ('SUBMITTED', 'HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED', 'REJECTED');

-- Create document type enum
CREATE TYPE public.document_type AS ENUM ('Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work', 'Session Plan', 'Class Attendance');

-- Create submission type enum
CREATE TYPE public.submission_type AS ENUM ('ONE_TIME', 'WEEKLY');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  pf_number TEXT,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Teaching assignments table
CREATE TABLE public.teaching_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trainer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  class_code TEXT NOT NULL,
  department TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'Term 1',
  academic_year TEXT NOT NULL DEFAULT '2024/2025',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;

-- Documents table
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.teaching_assignments(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type public.document_type NOT NULL,
  submission_type public.submission_type NOT NULL,
  week_number INTEGER,
  status public.document_status NOT NULL DEFAULT 'SUBMITTED',
  file_url TEXT,
  file_drive_id TEXT,
  file_name TEXT NOT NULL,
  department TEXT NOT NULL,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hod_approved_at TIMESTAMPTZ,
  dp_approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Audit logs table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Enable realtime for documents
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;

-- ==================== RLS POLICIES ====================

-- Profiles policies
CREATE POLICY "Anyone authenticated can view profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User roles policies
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Teaching assignments policies
CREATE POLICY "Trainers can view own assignments"
  ON public.teaching_assignments FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

CREATE POLICY "HOD/DP/IQA can view department assignments"
  ON public.teaching_assignments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'HOD') OR
    public.has_role(auth.uid(), 'DP_ACADEMICS') OR
    public.has_role(auth.uid(), 'IQA')
  );

-- Documents policies
CREATE POLICY "Trainers can view own documents"
  ON public.documents FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

CREATE POLICY "Trainers can insert own documents"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "HOD can view department documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'HOD'));

CREATE POLICY "DP can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'DP_ACADEMICS'));

CREATE POLICY "IQA can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'IQA'));

CREATE POLICY "HOD can update document status"
  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'HOD'));

CREATE POLICY "DP can update document status"
  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'DP_ACADEMICS'));

CREATE POLICY "IQA can update document status"
  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'IQA'));

-- Audit logs policies
CREATE POLICY "Authenticated users can view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can insert audit logs"
  ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ==================== FUNCTIONS & TRIGGERS ====================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_teaching_assignments_updated_at
  BEFORE UPDATE ON public.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Audit log trigger for document changes
CREATE OR REPLACE FUNCTION public.log_document_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_logs (document_id, action, performed_by, details)
    VALUES (
      NEW.id,
      'STATUS_CHANGE',
      auth.uid(),
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'document_type', NEW.document_type,
        'department', NEW.department
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_document_status_change
  AFTER UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.log_document_change();

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
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE like_escape('stamped\_%', '\')
      AND (
        public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'IQA')
      )
      AND public.can_stamp_document_file(name)
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      storage.filename(name) LIKE like_escape('stamped\_%', '\')
      AND (
        public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'IQA')
      )
      AND public.can_stamp_document_file(name)
    )
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
);

-- 1. Extend verification_packs with composition rules
ALTER TABLE public.verification_packs
  ADD COLUMN IF NOT EXISTS included_document_types text[],
  ADD COLUMN IF NOT EXISTS include_text_only_fallbacks boolean NOT NULL DEFAULT true;

-- 2. Verifiers directory
CREATE TABLE IF NOT EXISTS public.verifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  organisation text,
  phone text,
  departments text[] NOT NULL DEFAULT '{}',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verifiers TO authenticated;
GRANT ALL ON public.verifiers TO service_role;

ALTER TABLE public.verifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IQA/Admin manage verifiers"
  ON public.verifiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER trg_verifiers_updated_at
  BEFORE UPDATE ON public.verifiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Pack -> verifier assignments
CREATE TABLE IF NOT EXISTS public.verification_pack_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.verification_packs(id) ON DELETE CASCADE,
  verifier_id uuid NOT NULL REFERENCES public.verifiers(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  first_opened_at timestamptz,
  UNIQUE (pack_id, verifier_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_pack_assignees TO authenticated;
GRANT ALL ON public.verification_pack_assignees TO service_role;

ALTER TABLE public.verification_pack_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IQA/Admin manage pack assignees"
  ON public.verification_pack_assignees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- 4. Verifier reviews
DO $$ BEGIN
  CREATE TYPE public.verifier_decision AS ENUM ('APPROVED','QUERY','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.verifier_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.verification_packs(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  verifier_id uuid REFERENCES public.verifiers(id) ON DELETE SET NULL,
  decision public.verifier_decision NOT NULL,
  notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, document_id, verifier_id)
);

GRANT SELECT ON public.verifier_reviews TO authenticated;
GRANT ALL ON public.verifier_reviews TO service_role;

ALTER TABLE public.verifier_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IQA/Admin read reviews"
  ON public.verifier_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER trg_verifier_reviews_updated_at
  BEFORE UPDATE ON public.verifier_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_verifier_reviews_pack ON public.verifier_reviews(pack_id);
CREATE INDEX IF NOT EXISTS idx_verification_pack_assignees_pack ON public.verification_pack_assignees(pack_id);

-- 5. Stats function
CREATE OR REPLACE FUNCTION public.verification_pack_stats(_department text DEFAULT NULL, _capacity int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'department', _department,
    'total_packs', COUNT(*),
    'active', COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    'expired', COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now()),
    'revoked', COUNT(*) FILTER (WHERE revoked_at IS NOT NULL),
    'total_downloads', COALESCE(SUM(download_count), 0),
    'next_expiry', MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    'capacity', _capacity,
    'remaining_capacity', GREATEST(0, _capacity - COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()))
  )
  FROM public.verification_packs
  WHERE (_department IS NULL OR department = _department);
$$;

REVOKE ALL ON FUNCTION public.verification_pack_stats(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verification_pack_stats(text, int) TO authenticated, service_role;

-- 6. Per-department breakdown for the analytics panel
CREATE OR REPLACE FUNCTION public.verification_pack_stats_by_dept(_capacity int DEFAULT 10)
RETURNS TABLE (
  department text,
  total_packs bigint,
  active bigint,
  expired bigint,
  revoked bigint,
  total_downloads bigint,
  next_expiry timestamptz,
  remaining_capacity int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    department,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now())::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::bigint,
    COALESCE(SUM(download_count), 0)::bigint,
    MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    GREATEST(0, _capacity - COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int)
  FROM public.verification_packs
  GROUP BY department
  ORDER BY department;
$$;

REVOKE ALL ON FUNCTION public.verification_pack_stats_by_dept(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verification_pack_stats_by_dept(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verification_pack_stats(_department text DEFAULT NULL, _capacity int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'department', _department,
    'total_packs', COUNT(*),
    'active', COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    'expired', COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now()),
    'revoked', COUNT(*) FILTER (WHERE revoked_at IS NOT NULL),
    'total_downloads', COALESCE(SUM(download_count), 0),
    'next_expiry', MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    'capacity', _capacity,
    'remaining_capacity', GREATEST(0, _capacity - COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()))
  )
  FROM public.verification_packs
  WHERE (_department IS NULL OR department = _department);
$$;

CREATE OR REPLACE FUNCTION public.verification_pack_stats_by_dept(_capacity int DEFAULT 10)
RETURNS TABLE (
  department text,
  total_packs bigint,
  active bigint,
  expired bigint,
  revoked bigint,
  total_downloads bigint,
  next_expiry timestamptz,
  remaining_capacity int
)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    department,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now())::bigint,
    COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::bigint,
    COALESCE(SUM(download_count), 0)::bigint,
    MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()),
    GREATEST(0, _capacity - COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int)
  FROM public.verification_packs
  GROUP BY department
  ORDER BY department;
$$;

DROP FUNCTION IF EXISTS public.verification_pack_stats_by_dept(int);

CREATE TABLE IF NOT EXISTS public.department_pack_capacity (
  department text PRIMARY KEY,
  active_pack_limit int NOT NULL DEFAULT 10 CHECK (active_pack_limit BETWEEN 0 AND 200),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_pack_capacity TO authenticated;
GRANT ALL ON public.department_pack_capacity TO service_role;

ALTER TABLE public.department_pack_capacity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
DROP POLICY IF EXISTS "IQA and admins manage department pack capacity" ON public.department_pack_capacity;

CREATE POLICY "Auth users can read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated USING (true);

CREATE POLICY "IQA and admins manage department pack capacity"
  ON public.department_pack_capacity FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_dept_capacity_updated_at ON public.department_pack_capacity;
CREATE TRIGGER trg_dept_capacity_updated_at BEFORE UPDATE ON public.department_pack_capacity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.verification_pack_assignees
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.verification_pack_stats(_department text DEFAULT NULL, _capacity int DEFAULT 10)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH agg AS (
    SELECT
      COUNT(*) AS total_packs,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS active,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now()) AS expired,
      COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked,
      COALESCE(SUM(download_count),0) AS total_downloads,
      MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS next_expiry
    FROM public.verification_packs
    WHERE (_department IS NULL OR department = _department)
  ),
  cap AS (
    SELECT COALESCE(
      (SELECT active_pack_limit FROM public.department_pack_capacity WHERE department = _department),
      _capacity
    ) AS capacity
  )
  SELECT jsonb_build_object(
    'department', _department,
    'total_packs', agg.total_packs,
    'active', agg.active,
    'expired', agg.expired,
    'revoked', agg.revoked,
    'total_downloads', agg.total_downloads,
    'next_expiry', agg.next_expiry,
    'capacity', cap.capacity,
    'remaining_capacity', GREATEST(0, cap.capacity - agg.active)
  ) FROM agg, cap;
$$;

CREATE FUNCTION public.verification_pack_stats_by_dept(_capacity int DEFAULT 10)
RETURNS TABLE(department text, total_packs bigint, active bigint, expired bigint, revoked bigint,
  total_downloads bigint, next_expiry timestamptz, capacity int, remaining_capacity int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    vp.department,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now())::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at <= now())::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NOT NULL)::bigint,
    COALESCE(SUM(vp.download_count),0)::bigint,
    MIN(vp.expires_at) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now()),
    COALESCE(dpc.active_pack_limit, _capacity)::int,
    GREATEST(0, COALESCE(dpc.active_pack_limit, _capacity) - COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now())::int)
  FROM public.verification_packs vp
  LEFT JOIN public.department_pack_capacity dpc ON dpc.department = vp.department
  GROUP BY vp.department, dpc.active_pack_limit
  ORDER BY vp.department;
$$;

CREATE OR REPLACE FUNCTION public.document_pack_timeline(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc record;
  events jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT id, department, session_year, session_term
    INTO doc FROM public.documents WHERE id = _document_id;
  IF NOT FOUND THEN RETURN events; END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')::timestamptz), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('ts', vp.created_at, 'kind', 'pack_created',
      'meta', jsonb_build_object('pack_id', vp.id, 'token', vp.token)) AS e
    FROM public.verification_packs vp
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', vp.revoked_at, 'kind', 'pack_revoked',
      'meta', jsonb_build_object('pack_id', vp.id))
    FROM public.verification_packs vp
    WHERE vp.revoked_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.assigned_at, 'kind', 'verifier_assigned',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.first_opened_at, 'kind', 'pack_opened',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id, 'verifier_name', v.full_name))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.first_opened_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.reminder_sent_at, 'kind', 'reminder_sent',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.reminder_sent_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', al.created_at, 'kind', al.action, 'meta', al.details)
    FROM public.audit_logs al
    WHERE al.action IN ('PACK_DOWNLOADED','PACK_OPENED')
      AND (al.details->>'pack_id') IN (
        SELECT id::text FROM public.verification_packs
        WHERE department = doc.department AND session_year = doc.session_year AND session_term = doc.session_term)
    UNION ALL
    SELECT jsonb_build_object('ts', r.reviewed_at, 'kind', 'review_submitted',
      'meta', jsonb_build_object('pack_id', r.pack_id, 'verifier_id', r.verifier_id,
        'decision', r.decision, 'notes', r.notes, 'verifier_name', v.full_name))
    FROM public.verifier_reviews r
    LEFT JOIN public.verifiers v ON v.id = r.verifier_id
    WHERE r.document_id = _document_id
  ) sub WHERE e->>'ts' IS NOT NULL;

  RETURN events;
END;
$$;

REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.document_pack_timeline(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.document_pack_timeline(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc record;
  events jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT id, department, session_year, session_term
    INTO doc FROM public.documents WHERE id = _document_id;
  IF NOT FOUND THEN RETURN events; END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')::timestamptz), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('ts', vp.created_at, 'kind', 'pack_created',
      'meta', jsonb_build_object('pack_id', vp.id, 'token', vp.token)) AS e
    FROM public.verification_packs vp
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', vp.revoked_at, 'kind', 'pack_revoked',
      'meta', jsonb_build_object('pack_id', vp.id))
    FROM public.verification_packs vp
    WHERE vp.revoked_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.assigned_at, 'kind', 'verifier_assigned',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.first_opened_at, 'kind', 'pack_opened',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id, 'verifier_name', v.full_name))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.first_opened_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.reminder_sent_at, 'kind', 'reminder_sent',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.reminder_sent_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', al.created_at, 'kind',
      CASE WHEN al.action IN ('PACK_DOWNLOADED','VERIFICATION_PACK_DOWNLOADED') THEN 'pack_downloaded'
           WHEN al.action = 'PACK_OPENED' THEN 'pack_opened_log'
           ELSE lower(al.action) END,
      'meta', al.details)
    FROM public.audit_logs al
    WHERE al.action IN ('PACK_DOWNLOADED','VERIFICATION_PACK_DOWNLOADED','PACK_OPENED','VERIFIER_REMINDER_SENT')
      AND (al.details->>'pack_id') IN (
        SELECT id::text FROM public.verification_packs
        WHERE department = doc.department AND session_year = doc.session_year AND session_term = doc.session_term)
    UNION ALL
    SELECT jsonb_build_object('ts', r.reviewed_at, 'kind', 'review_submitted',
      'meta', jsonb_build_object('pack_id', r.pack_id, 'verifier_id', r.verifier_id,
        'decision', r.decision, 'notes', r.notes, 'verifier_name', v.full_name))
    FROM public.verifier_reviews r
    LEFT JOIN public.verifiers v ON v.id = r.verifier_id
    WHERE r.document_id = _document_id
  ) sub WHERE e->>'ts' IS NOT NULL;

  RETURN events;
END;
$$;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_tier text NOT NULL DEFAULT 'cloud'
    CHECK (storage_tier IN ('cloud','drive','both')),
  ADD COLUMN IF NOT EXISTS drive_offloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_offloaded_by uuid;

CREATE INDEX IF NOT EXISTS idx_documents_storage_tier ON public.documents(storage_tier);
CREATE INDEX IF NOT EXISTS idx_documents_dept_trainer ON public.documents(department, trainer_id);

CREATE TABLE IF NOT EXISTS public.offload_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  cron_schedule TEXT NOT NULL DEFAULT '0 2 * * 0', -- weekly Sun 02:00
  min_age_days INTEGER NOT NULL DEFAULT 30,
  only_tier TEXT NOT NULL DEFAULT 'cloud', -- 'cloud' | 'both'
  max_files_per_run INTEGER NOT NULL DEFAULT 100,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offload_schedules TO authenticated;
GRANT ALL ON public.offload_schedules TO service_role;
ALTER TABLE public.offload_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IQA and admins manage schedules"
ON public.offload_schedules FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER trg_offload_schedules_updated
BEFORE UPDATE ON public.offload_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.export_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL UNIQUE,
  actor UUID REFERENCES auth.users(id),
  kind TEXT NOT NULL, -- 'session_export' | 'offload'
  department TEXT,
  session_year INTEGER,
  session_term TEXT,
  phase TEXT NOT NULL DEFAULT 'queued', -- queued|running|success|error
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.export_progress TO authenticated;
GRANT ALL ON public.export_progress TO service_role;
ALTER TABLE public.export_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Actors and staff can view progress"
ON public.export_progress FOR SELECT TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'DP_ACADEMICS')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

CREATE POLICY "Actors can create own progress row"
ON public.export_progress FOR INSERT TO authenticated
WITH CHECK (actor = auth.uid());

CREATE POLICY "Actors and staff can update progress"
ON public.export_progress FOR UPDATE TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

CREATE TRIGGER trg_export_progress_updated
BEFORE UPDATE ON public.export_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.export_progress;
ALTER TABLE public.export_progress REPLICA IDENTITY FULL;

CREATE TABLE public.drive_folder_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('root','department')),
  department TEXT,
  folder_id TEXT NOT NULL,
  folder_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
CREATE UNIQUE INDEX drive_folder_map_scope_dept_uniq
  ON public.drive_folder_map (scope, COALESCE(department, ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_folder_map TO authenticated;
GRANT ALL ON public.drive_folder_map TO service_role;

ALTER TABLE public.drive_folder_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin manages drive folder map"
  ON public.drive_folder_map
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TABLE public.integration_health_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('healthcheck','smoke_test')),
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  actor UUID,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_health_runs TO authenticated;
GRANT ALL ON public.integration_health_runs TO service_role;

ALTER TABLE public.integration_health_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin reads health runs"
  ON public.integration_health_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "super admin writes health runs"
  ON public.integration_health_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));
CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Exact path structure: <trainer_id>/<assignment_id-or-'unassigned'>/stamped_*.pdf
      AND split_part(_path, '/', 1) = d.trainer_id::text
      AND split_part(_path, '/', 2) = COALESCE(d.assignment_id::text, 'unassigned')
      AND split_part(_path, '/', 3) LIKE 'stamped\_%' ESCAPE '\'
      AND split_part(_path, '/', 3) <> ''
      AND split_part(_path, '/', 4) = ''
  );
$function$;
-- 1. Academic sessions (Super Admin controlled)
CREATE TABLE public.academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_year int NOT NULL,
  session_term text NOT NULL CHECK (session_term IN ('JAN_APR','MAY_AUG','SEP_DEC')),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','OPEN','LOCKED','CLOSED')),
  submission_opens_at timestamptz,
  submission_closes_at timestamptz,
  late_grace_days int NOT NULL DEFAULT 0,
  is_current boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (session_year, session_term)
);

GRANT SELECT ON public.academic_sessions TO authenticated;
GRANT ALL ON public.academic_sessions TO service_role;

ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read sessions"
  ON public.academic_sessions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Super Admin manages sessions"
  ON public.academic_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER academic_sessions_updated_at
  BEFORE UPDATE ON public.academic_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Only one is_current true at a time
CREATE OR REPLACE FUNCTION public.enforce_single_current_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.academic_sessions SET is_current = false
      WHERE id <> NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER academic_sessions_single_current
  AFTER INSERT OR UPDATE OF is_current ON public.academic_sessions
  FOR EACH ROW WHEN (NEW.is_current = true)
  EXECUTE FUNCTION public.enforce_single_current_session();

-- 2. Document templates library
CREATE TABLE public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  department text,
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_name text,
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  source_document_id uuid,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_templates TO authenticated;
GRANT ALL ON public.document_templates TO service_role;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read active templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(),'SUPER_ADMIN'));
CREATE POLICY "Super Admin manages templates"
  ON public.document_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Return-to-previous-stage support on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS return_note text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES auth.users(id);

-- 4. Update guard trigger to allow DP -> HOD and IQA -> DP returns
CREATE OR REPLACE FUNCTION public.guard_document_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND NEW.status IN ('DP_APPROVED','REJECTED','SUBMITTED') THEN
      -- SUBMITTED here means "return to HOD stage". Require a return_note.
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','HOD_APPROVED') THEN
      -- HOD_APPROVED here means "return to DP stage". Require a return_note.
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to DP';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_single_current_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;

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

CREATE TABLE IF NOT EXISTS public.sla_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type public.document_type NOT NULL,
  stage text NOT NULL CHECK (stage IN ('HOD','DP','IQA')),
  target_hours integer NOT NULL CHECK (target_hours > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (document_type, stage)
);

GRANT SELECT ON public.sla_targets TO authenticated;
GRANT ALL ON public.sla_targets TO service_role;

ALTER TABLE public.sla_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_targets_read_all"
  ON public.sla_targets FOR SELECT TO authenticated USING (true);

CREATE POLICY "sla_targets_super_admin_write"
  ON public.sla_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER sla_targets_updated_at
  BEFORE UPDATE ON public.sla_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Restrict department_pack_capacity read to IQA / Super Admin (writers already scoped)
DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "IQA and admins read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

-- Restrict sla_targets read to approver roles + Super Admin
DROP POLICY IF EXISTS "sla_targets_read_all" ON public.sla_targets;
CREATE POLICY "sla_targets_read_privileged"
  ON public.sla_targets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'HOD')
    OR public.has_role(auth.uid(),'DP_ACADEMICS')
    OR public.has_role(auth.uid(),'IQA')
    OR public.has_role(auth.uid(),'SUPER_ADMIN')
  );

-- Restrict system_settings read: hide locked_by_email/locked_by from non-admins by
-- limiting direct row reads to Super Admin, and expose safe lock status via RPC.
DROP POLICY IF EXISTS "Authenticated can read lock" ON public.system_settings;
CREATE POLICY "Super Admin reads full system settings"
  ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE OR REPLACE FUNCTION public.get_system_lock_public()
RETURNS TABLE(lock_active boolean, lock_reason text, locked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lock_active, lock_reason, locked_at
  FROM public.system_settings WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_system_lock_public() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_lock_public() TO authenticated;

-- Add explicit restrictive block so nobody can insert/update verifier_reviews from
-- client (only edge functions with service_role write here). This makes the
-- "no write policy" state explicit and future-proof.
CREATE POLICY "verifier_reviews_block_client_writes"
  ON public.verifier_reviews AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
ALTER TABLE public.verification_packs
  ADD COLUMN IF NOT EXISTS include_dp_approved boolean NOT NULL DEFAULT false;-- New enum values (added here, used in later migrations)
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'IQA_REVIEWED' AFTER 'HOD_APPROVED';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'Records of Work Covered';

-- Courses: department -> course -> unit
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT ALL ON public.courses TO service_role;

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read courses"
  ON public.courses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admins manage courses"
  ON public.courses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "HODs manage own department courses"
  ON public.courses FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'HOD')
    AND department = (SELECT p.department FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'HOD')
    AND department = (SELECT p.department FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link units and documents to a course
ALTER TABLE public.unit_session_config
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;

-- Onboarding checklist progress
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  step_key text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, step_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_progress TO authenticated;
GRANT ALL ON public.onboarding_progress TO service_role;

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own onboarding progress"
  ON public.onboarding_progress FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_onboarding_progress_updated_at
  BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean := (auth.uid() = OLD.trainer_id);
  is_super boolean := public.has_role(auth.uid(), 'SUPER_ADMIN');
BEGIN
  IF is_super THEN
    RETURN NEW;
  END IF;

  IF is_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('HOD_APPROVED','IQA_REVIEWED','DP_APPROVED','ARCHIVED') THEN
      RAISE EXCEPTION 'Trainers cannot approve their own documents';
    END IF;
    RETURN NEW;
  END IF;

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
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'HOD_APPROVED'
       AND NEW.status IN ('IQA_REVIEWED','REJECTED','SUBMITTED') THEN
      -- SUBMITTED here means "return to HOD stage". Require a return_note.
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'DP_ACADEMICS') AND OLD.status = 'IQA_REVIEWED'
       AND NEW.status IN ('DP_APPROVED','REJECTED','HOD_APPROVED') THEN
      -- HOD_APPROVED here means "return to IQA review stage". Require a return_note.
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to IQA review';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','IQA_REVIEWED') THEN
      -- IQA_REVIEWED here means "return to DP stage". Require a return_note.
      IF NEW.status = 'IQA_REVIEWED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to DP';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    LEFT JOIN public.profiles p ON p.user_id = auth.uid()
    WHERE (
        (public.has_role(auth.uid(), 'HOD')
          AND d.status = 'SUBMITTED'
          AND d.department = p.department)
        OR (public.has_role(auth.uid(), 'IQA')
          AND d.status IN ('HOD_APPROVED','DP_APPROVED'))
        OR (public.has_role(auth.uid(), 'DP_ACADEMICS')
          AND d.status = 'IQA_REVIEWED')
      )
      -- Exact path structure: <trainer_id>/<assignment_id-or-'unassigned'>/stamped_*.pdf
      AND split_part(_path, '/', 1) = d.trainer_id::text
      AND split_part(_path, '/', 2) = COALESCE(d.assignment_id::text, 'unassigned')
      AND split_part(_path, '/', 3) LIKE 'stamped\_%' ESCAPE '\'
      AND split_part(_path, '/', 3) <> ''
      AND split_part(_path, '/', 4) = ''
  );
$function$;ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS iqa_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS iqa_reviewed_by uuid;CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  kind text NOT NULL,
  stage text,
  stage_order integer,
  stage_total integer,
  stamp_version text,
  layout_version text,
  title text NOT NULL,
  message text,
  note text,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Authenticated users can create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE TABLE public.stamp_layouts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_title text NOT NULL DEFAULT 'DOCUMENT APPROVAL & VERIFICATION SHEET',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stamp_layouts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stamp_layouts TO authenticated;
GRANT ALL ON public.stamp_layouts TO service_role;

ALTER TABLE public.stamp_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read stamp layouts"
  ON public.stamp_layouts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admins manage stamp layouts insert"
  ON public.stamp_layouts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins manage stamp layouts update"
  ON public.stamp_layouts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins manage stamp layouts delete"
  ON public.stamp_layouts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER trg_stamp_layouts_updated_at
  BEFORE UPDATE ON public.stamp_layouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.stamp_layouts (name, version, is_active, stages)
VALUES (
  'Standard 2026', 1, true,
  '[
    {"stage":"HOD","order":1,"title":"1. VERIFIED BY HEAD OF DEPARTMENT","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10},
    {"stage":"IQA_REVIEW","order":2,"title":"2. VERIFIED BY INTERNAL QUALITY ASSURANCE","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10},
    {"stage":"DP","order":3,"title":"3. APPROVED BY DEPUTY PRINCIPAL - ACADEMICS","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10}
  ]'::jsonb
);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS stamp_layout_version text,
  ADD COLUMN IF NOT EXISTS stamp_stage_order integer;DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;

CREATE POLICY "Approvers notify document owners"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR (
    (
      public.has_role(auth.uid(), 'HOD')
      OR public.has_role(auth.uid(), 'IQA')
      OR public.has_role(auth.uid(), 'DP_ACADEMICS')
      OR public.has_role(auth.uid(), 'SUPER_ADMIN')
    )
    AND document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = notifications.document_id
        AND d.trainer_id = notifications.user_id
    )
  )
);

CREATE POLICY "Super admins can delete verification packs"
ON public.verification_packs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

GRANT DELETE ON public.verification_packs TO authenticated;CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_table text,
  target_id text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read security events"
ON public.security_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE INDEX idx_security_events_created_at ON public.security_events (created_at DESC);ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_file_url text,
  ADD COLUMN IF NOT EXISTS rejection_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rejected_stage text,
  ADD COLUMN IF NOT EXISTS last_rejected_by uuid,
  ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rejection_reason text,
  ADD COLUMN IF NOT EXISTS resubmission_note text;

CREATE TABLE IF NOT EXISTS public.document_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  stage text NOT NULL,
  reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  document_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_rejections TO authenticated;
GRANT ALL ON public.document_rejections TO service_role;

ALTER TABLE public.document_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View rejection history for visible documents"
ON public.document_rejections FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id
      AND (
        d.trainer_id = auth.uid()
        OR public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'IQA')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'SUPER_ADMIN')
      )
  )
);

CREATE POLICY "Approvers record rejections"
ON public.document_rejections FOR INSERT TO authenticated
WITH CHECK (
  rejected_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'HOD')
    OR public.has_role(auth.uid(), 'IQA')
    OR public.has_role(auth.uid(), 'DP_ACADEMICS')
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
);

CREATE INDEX IF NOT EXISTS document_rejections_document_idx ON public.document_rejections(document_id, created_at DESC);CREATE UNIQUE INDEX IF NOT EXISTS documents_one_workload_per_session
  ON public.documents (trainer_id, session_year, session_term)
  WHERE document_type = 'Workload Allocation'::public.document_type
    AND status <> 'REJECTED'::public.document_status;