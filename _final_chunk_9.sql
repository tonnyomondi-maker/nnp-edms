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

DROP POLICY IF EXISTS "IQA/Admin manage verifiers" ON public.verifiers;
CREATE POLICY "IQA/Admin manage verifiers"
  ON public.verifiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_verifiers_updated_at ON UPDATE;
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

DROP POLICY IF EXISTS "IQA/Admin manage pack assignees" ON public.verification_pack_assignees;
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

DROP POLICY IF EXISTS "IQA/Admin read reviews" ON public.verifier_reviews;
CREATE POLICY "IQA/Admin read reviews"
  ON public.verifier_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'IQA') OR public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_verifier_reviews_updated_at ON UPDATE;
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