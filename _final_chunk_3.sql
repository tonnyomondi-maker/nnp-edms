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