DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;
CREATE POLICY "Signatures are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Users upload own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own signatures" ON storage.objects;
CREATE POLICY "Users upload own signatures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users update own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users update own signatures" ON storage.objects;
CREATE POLICY "Users update own signatures"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users delete own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own signatures" ON storage.objects;
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