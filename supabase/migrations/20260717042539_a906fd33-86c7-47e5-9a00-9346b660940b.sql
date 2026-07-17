
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

CREATE POLICY "Auth users can read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated USING (true);

CREATE POLICY "IQA and admins manage department pack capacity"
  ON public.department_pack_capacity FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_dept_capacity_updated_at ON public.department_pack_capacity;
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
    COALESCE(SUM(vp.download_count),0)::bigint,
    MIN(vp.expires_at) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now()),
    COALESCE(dpc.active_pack_limit, _capacity)::int,
    GREATEST(0, COALESCE(dpc.active_pack_limit, _capacity) - COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now())::int)
  FROM public.verification_packs vp
  LEFT JOIN public.department_pack_capacity dpc ON dpc.department = vp.department
  GROUP BY vp.department, dpc.active_pack_limit
  ORDER BY vp.department;
$$;

CREATE OR REPLACE FUNCTION public.document_pack_timeline(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc record;
  events jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT id, department, session_year, session_term
    INTO doc FROM public.documents WHERE id = _document_id;
  IF NOT FOUND THEN RETURN events; END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')::timestamptz), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('ts', vp.created_at, 'kind', 'pack_created',
      'meta', jsonb_build_object('pack_id', vp.id, 'token', vp.token)) AS e
    FROM public.verification_packs vp
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', vp.revoked_at, 'kind', 'pack_revoked',
      'meta', jsonb_build_object('pack_id', vp.id))
    FROM public.verification_packs vp
    WHERE vp.revoked_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.assigned_at, 'kind', 'verifier_assigned',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.first_opened_at, 'kind', 'pack_opened',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id, 'verifier_name', v.full_name))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.first_opened_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.reminder_sent_at, 'kind', 'reminder_sent',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.reminder_sent_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', al.created_at, 'kind', al.action, 'meta', al.details)
    FROM public.audit_logs al
    WHERE al.action IN ('PACK_DOWNLOADED','PACK_OPENED')
      AND (al.details->>'pack_id') IN (
        SELECT id::text FROM public.verification_packs
        WHERE department = doc.department AND session_year = doc.session_year AND session_term = doc.session_term)
    UNION ALL
    SELECT jsonb_build_object('ts', r.reviewed_at, 'kind', 'review_submitted',
      'meta', jsonb_build_object('pack_id', r.pack_id, 'verifier_id', r.verifier_id,
        'decision', r.decision, 'notes', r.notes, 'verifier_name', v.full_name))
    FROM public.verifier_reviews r
    LEFT JOIN public.verifiers v ON v.id = r.verifier_id
    WHERE r.document_id = _document_id
  ) sub WHERE e->>'ts' IS NOT NULL;

  RETURN events;
END;
$$;

REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.document_pack_timeline(uuid) TO authenticated;
