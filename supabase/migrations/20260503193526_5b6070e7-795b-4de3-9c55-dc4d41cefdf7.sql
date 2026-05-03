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
