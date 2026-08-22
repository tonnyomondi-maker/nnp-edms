  ON public.document_type_policy FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS document_type_policy_updated_at ON UPDATE;
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

DROP POLICY IF EXISTS "IQA and SuperAdmin can view packs" ON public.verification_packs;
CREATE POLICY "IQA and SuperAdmin can view packs"
  ON public.verification_packs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP POLICY IF EXISTS "IQA and SuperAdmin can create packs" ON public.verification_packs;
CREATE POLICY "IQA and SuperAdmin can create packs"
  ON public.verification_packs FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "IQA and SuperAdmin can revoke packs" ON public.verification_packs;
CREATE POLICY "IQA and SuperAdmin can revoke packs"
  ON public.verification_packs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS update_verification_packs_updated_at ON UPDATE;
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