
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
