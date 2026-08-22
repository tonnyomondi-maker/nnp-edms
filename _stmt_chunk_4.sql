

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

DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "Auth users can read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "IQA and admins manage department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "IQA and admins manage department pack capacity"
  ON public.department_pack_capacity FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_dept_capacity_updated_at ON public.department_pack_capacity;