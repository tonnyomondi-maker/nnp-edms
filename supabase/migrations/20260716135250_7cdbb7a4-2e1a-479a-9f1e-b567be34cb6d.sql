
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
