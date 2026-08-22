
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
    SELECT jsonb_build_object('ts', al.created_at, 'kind',
      CASE WHEN al.action IN ('PACK_DOWNLOADED','VERIFICATION_PACK_DOWNLOADED') THEN 'pack_downloaded'
           WHEN al.action = 'PACK_OPENED' THEN 'pack_opened_log'
           ELSE lower(al.action) END,
      'meta', al.details)
    FROM public.audit_logs al
    WHERE al.action IN ('PACK_DOWNLOADED','VERIFICATION_PACK_DOWNLOADED','PACK_OPENED','VERIFIER_REMINDER_SENT')
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


ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_tier text NOT NULL DEFAULT 'cloud'
    CHECK (storage_tier IN ('cloud','drive','both')),
  ADD COLUMN IF NOT EXISTS drive_offloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_offloaded_by uuid;

CREATE INDEX IF NOT EXISTS idx_documents_storage_tier ON public.documents(storage_tier);
CREATE INDEX IF NOT EXISTS idx_documents_dept_trainer ON public.documents(department, trainer_id);


CREATE TABLE IF NOT EXISTS public.offload_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  cron_schedule TEXT NOT NULL DEFAULT '0 2 * * 0', -- weekly Sun 02:00
  min_age_days INTEGER NOT NULL DEFAULT 30,
  only_tier TEXT NOT NULL DEFAULT 'cloud', -- 'cloud' | 'both'
  max_files_per_run INTEGER NOT NULL DEFAULT 100,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offload_schedules TO authenticated;
GRANT ALL ON public.offload_schedules TO service_role;
ALTER TABLE public.offload_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "IQA and admins manage schedules" ON public.offload_schedules;
CREATE POLICY "IQA and admins manage schedules"
ON public.offload_schedules FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS trg_offload_schedules_updated ON UPDATE;
CREATE TRIGGER trg_offload_schedules_updated
BEFORE UPDATE ON public.offload_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.export_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL UNIQUE,
  actor UUID REFERENCES auth.users(id),
  kind TEXT NOT NULL, -- 'session_export' | 'offload'
  department TEXT,
  session_year INTEGER,
  session_term TEXT,
  phase TEXT NOT NULL DEFAULT 'queued', -- queued|running|success|error
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.export_progress TO authenticated;
GRANT ALL ON public.export_progress TO service_role;
ALTER TABLE public.export_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Actors and staff can view progress" ON public.export_progress;
CREATE POLICY "Actors and staff can view progress"
ON public.export_progress FOR SELECT TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'DP_ACADEMICS')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

DROP POLICY IF EXISTS "Actors can create own progress row" ON public.export_progress;
CREATE POLICY "Actors can create own progress row"
ON public.export_progress FOR INSERT TO authenticated
WITH CHECK (actor = auth.uid());

DROP POLICY IF EXISTS "Actors and staff can update progress" ON public.export_progress;
CREATE POLICY "Actors and staff can update progress"
ON public.export_progress FOR UPDATE TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

DROP TRIGGER IF EXISTS trg_export_progress_updated ON UPDATE;
CREATE TRIGGER trg_export_progress_updated
BEFORE UPDATE ON public.export_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.export_progress;
ALTER TABLE public.export_progress REPLICA IDENTITY FULL;


CREATE TABLE IF NOT EXISTS public.drive_folder_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('root','department')),
  department TEXT,
  folder_id TEXT NOT NULL,
  folder_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
CREATE UNIQUE INDEX drive_folder_map_scope_dept_uniq
  ON public.drive_folder_map (scope, COALESCE(department, ''));