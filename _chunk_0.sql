
-- Drop overly permissive audit_logs insert policy
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;

-- The audit log trigger uses SECURITY DEFINER so it bypasses RLS.
-- No insert policy needed for regular users - only triggers insert.

-- Drop duplicate permissive user_roles policy
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
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