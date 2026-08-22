
CREATE POLICY "Users delete own signatures"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Make documents bucket files readable by approvers (so edge function can fetch via service role - already covered, but ensure read for authenticated)
DROP POLICY IF EXISTS "Authenticated can read documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can read documents bucket"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "Authenticated can write documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can write documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can write documents bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "Authenticated can update documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update documents bucket" ON storage.objects;
CREATE POLICY "Authenticated can update documents bucket"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'documents');
ALTER TABLE public.documents
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
  ADD COLUMN IF NOT EXISTS iqa_stamp_y numeric;
-- Add EXPORTED status to enum
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'EXPORTED';

-- Add export tracking columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_by UUID;

CREATE INDEX IF NOT EXISTS idx_documents_archived_at ON public.documents(archived_at);
CREATE INDEX IF NOT EXISTS idx_documents_exported_at ON public.documents(exported_at);
-- 1. Documents: make assignment_id nullable + add session/unit fields
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

DROP POLICY IF EXISTS "Trainers manage own unit configs" ON public.unit_session_config;
CREATE POLICY "Trainers manage own unit configs"
  ON public.unit_session_config
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

DROP POLICY IF EXISTS "HOD/DP/IQA can view unit configs" ON public.unit_session_config;
CREATE POLICY "HOD/DP/IQA can view unit configs"
  ON public.unit_session_config
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'HOD'::app_role)
    OR has_role(auth.uid(), 'DP_ACADEMICS'::app_role)
    OR has_role(auth.uid(), 'IQA'::app_role)
  );

DROP TRIGGER IF EXISTS update_unit_session_config_updated_at ON UPDATE;
CREATE TRIGGER update_unit_session_config_updated_at
  BEFORE UPDATE ON public.unit_session_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_documents_session 
  ON public.documents(session_year, session_term);
CREATE INDEX IF NOT EXISTS idx_documents_unit_code 
  ON public.documents(unit_code);
ALTER TABLE public.unit_session_config ADD COLUMN IF NOT EXISTS term_number INTEGER CHECK (term_number BETWEEN 1 AND 3);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS term_number INTEGER CHECK (term_number BETWEEN 1 AND 3);







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

DROP POLICY IF EXISTS "HOD can view own department documents" ON public.documents;
CREATE POLICY "HOD can view own department documents"
  ON public.documents FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'HOD'::app_role)
    AND department = (SELECT department FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HOD can update own department documents" ON public.documents;
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
DROP POLICY IF EXISTS "Anyone can read documents bucket" ON storage.objects;
CREATE POLICY "Anyone can read documents bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

-- Trainers can upload to their own folder (user_id prefix)
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
DROP POLICY IF EXISTS "Trainers can upload own documents" ON storage.objects;
CREATE POLICY "Trainers can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service role / approvers can write stamped versions (edge function uses service role)
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload to documents" ON storage.objects;
CREATE POLICY "Authenticated can upload to documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');
-- Make documents bucket private (use signed URLs everywhere)
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
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'SUPER_ADMIN'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'SUPER_ADMIN';
  END IF;
END$$;
-- 1. Allow modules 1-10
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
DROP POLICY IF EXISTS "Super admins can view all roles" ON public.user_roles;