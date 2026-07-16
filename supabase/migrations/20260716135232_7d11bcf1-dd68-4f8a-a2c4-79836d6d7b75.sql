
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
