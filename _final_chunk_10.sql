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
DROP TRIGGER IF EXISTS trg_dept_capacity_updated_at ON UPDATE;
CREATE TRIGGER trg_dept_capacity_updated_at BEFORE UPDATE ON public.department_pack_capacity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.verification_pack_assignees
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.verification_pack_stats(_department text DEFAULT NULL, _capacity int DEFAULT 10)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH agg AS (
    SELECT
      COUNT(*) AS total_packs,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS active,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now()) AS expired,
      COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked,
      COALESCE(SUM(download_count),0) AS total_downloads,
      MIN(expires_at) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS next_expiry
    FROM public.verification_packs
    WHERE (_department IS NULL OR department = _department)
  ),
  cap AS (
    SELECT COALESCE(
      (SELECT active_pack_limit FROM public.department_pack_capacity WHERE department = _department),
      _capacity
    ) AS capacity
  )
  SELECT jsonb_build_object(
    'department', _department,
    'total_packs', agg.total_packs,
    'active', agg.active,
    'expired', agg.expired,
    'revoked', agg.revoked,
    'total_downloads', agg.total_downloads,
    'next_expiry', agg.next_expiry,
    'capacity', cap.capacity,
    'remaining_capacity', GREATEST(0, cap.capacity - agg.active)
  ) FROM agg, cap;
$$;

CREATE FUNCTION public.verification_pack_stats_by_dept(_capacity int DEFAULT 10)
RETURNS TABLE(department text, total_packs bigint, active bigint, expired bigint, revoked bigint,
  total_downloads bigint, next_expiry timestamptz, capacity int, remaining_capacity int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    vp.department,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now())::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at <= now())::bigint,
    COUNT(*) FILTER (WHERE vp.revoked_at IS NOT NULL)::bigint,