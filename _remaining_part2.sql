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

CREATE POLICY "IQA and admins manage schedules"
ON public.offload_schedules FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

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

CREATE POLICY "Actors and staff can view progress"
ON public.export_progress FOR SELECT TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'DP_ACADEMICS')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

CREATE POLICY "Actors can create own progress row"
ON public.export_progress FOR INSERT TO authenticated
WITH CHECK (actor = auth.uid());

CREATE POLICY "Actors and staff can update progress"
ON public.export_progress FOR UPDATE TO authenticated
USING (
  actor = auth.uid()
  OR public.has_role(auth.uid(),'IQA')
  OR public.has_role(auth.uid(),'SUPER_ADMIN')
);

CREATE TRIGGER trg_export_progress_updated
BEFORE UPDATE ON public.export_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.export_progress;
ALTER TABLE public.export_progress REPLICA IDENTITY FULL;

CREATE TABLE public.drive_folder_map (
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_folder_map TO authenticated;
GRANT ALL ON public.drive_folder_map TO service_role;

ALTER TABLE public.drive_folder_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin manages drive folder map"
  ON public.drive_folder_map
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TABLE public.integration_health_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('healthcheck','smoke_test')),
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  actor UUID,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_health_runs TO authenticated;
GRANT ALL ON public.integration_health_runs TO service_role;

ALTER TABLE public.integration_health_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin reads health runs"
  ON public.integration_health_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "super admin writes health runs"
  ON public.integration_health_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));
CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Exact path structure: <trainer_id>/<assignment_id-or-'unassigned'>/stamped_*.pdf
      AND split_part(_path, '/', 1) = d.trainer_id::text
      AND split_part(_path, '/', 2) = COALESCE(d.assignment_id::text, 'unassigned')
      AND split_part(_path, '/', 3) LIKE 'stamped\_%' ESCAPE '\'
      AND split_part(_path, '/', 3) <> ''
      AND split_part(_path, '/', 4) = ''
  );
$function$;
-- 1. Academic sessions (Super Admin controlled)
CREATE TABLE public.academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_year int NOT NULL,
  session_term text NOT NULL CHECK (session_term IN ('JAN_APR','MAY_AUG','SEP_DEC')),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','OPEN','LOCKED','CLOSED')),
  submission_opens_at timestamptz,
  submission_closes_at timestamptz,
  late_grace_days int NOT NULL DEFAULT 0,
  is_current boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (session_year, session_term)
);

GRANT SELECT ON public.academic_sessions TO authenticated;
GRANT ALL ON public.academic_sessions TO service_role;

ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read sessions"
  ON public.academic_sessions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Super Admin manages sessions"
  ON public.academic_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER academic_sessions_updated_at
  BEFORE UPDATE ON public.academic_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Only one is_current true at a time
CREATE OR REPLACE FUNCTION public.enforce_single_current_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.academic_sessions SET is_current = false
      WHERE id <> NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER academic_sessions_single_current
  AFTER INSERT OR UPDATE OF is_current ON public.academic_sessions
  FOR EACH ROW WHEN (NEW.is_current = true)
  EXECUTE FUNCTION public.enforce_single_current_session();

-- 2. Document templates library
CREATE TABLE public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  department text,
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_name text,
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  source_document_id uuid,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_templates TO authenticated;
GRANT ALL ON public.document_templates TO service_role;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read active templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(),'SUPER_ADMIN'));
CREATE POLICY "Super Admin manages templates"
  ON public.document_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TRIGGER document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Return-to-previous-stage support on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS return_note text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES auth.users(id);

-- 4. Update guard trigger to allow DP -> HOD and IQA -> DP returns
CREATE OR REPLACE FUNCTION public.guard_document_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean := (auth.uid() = OLD.trainer_id);
  is_super boolean := public.has_role(auth.uid(), 'SUPER_ADMIN');
BEGIN
  IF is_super THEN
    RETURN NEW;
  END IF;

  IF is_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('HOD_APPROVED','DP_APPROVED','ARCHIVED') THEN
      RAISE EXCEPTION 'Trainers cannot approve their own documents';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.submission_type IS DISTINCT FROM OLD.submission_type
     OR NEW.department IS DISTINCT FROM OLD.department
     OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
     OR NEW.session_year IS DISTINCT FROM OLD.session_year
     OR NEW.session_term IS DISTINCT FROM OLD.session_term
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  THEN
    RAISE EXCEPTION 'Approvers may not modify document identity or payload fields';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF public.has_role(auth.uid(),'HOD') AND OLD.status = 'SUBMITTED'
       AND NEW.status IN ('HOD_APPROVED','REJECTED') THEN
      NULL;
    ELSIF public.has_role(auth.uid(),'DP_ACADEMICS') AND OLD.status = 'HOD_APPROVED'
       AND NEW.status IN ('DP_APPROVED','REJECTED','SUBMITTED') THEN
      -- SUBMITTED here means "return to HOD stage". Require a return_note.
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','HOD_APPROVED') THEN
      -- HOD_APPROVED here means "return to DP stage". Require a return_note.
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to DP';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_single_current_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;

CREATE POLICY "Templates readable by any signed-in user"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'templates');

CREATE POLICY "Super Admin writes templates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "Super Admin updates templates"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE POLICY "Super Admin deletes templates"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TABLE IF NOT EXISTS public.sla_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type public.document_type NOT NULL,
  stage text NOT NULL CHECK (stage IN ('HOD','DP','IQA')),
  target_hours integer NOT NULL CHECK (target_hours > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (document_type, stage)
);

GRANT SELECT ON public.sla_targets TO authenticated;
GRANT ALL ON public.sla_targets TO service_role;

ALTER TABLE public.sla_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_targets_read_all"
  ON public.sla_targets FOR SELECT TO authenticated USING (true);

CREATE POLICY "sla_targets_super_admin_write"
  ON public.sla_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER sla_targets_updated_at
  BEFORE UPDATE ON public.sla_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Restrict department_pack_capacity read to IQA / Super Admin (writers already scoped)
DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "IQA and admins read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

-- Restrict sla_targets read to approver roles + Super Admin
DROP POLICY IF EXISTS "sla_targets_read_all" ON public.sla_targets;
CREATE POLICY "sla_targets_read_privileged"
  ON public.sla_targets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'HOD')
    OR public.has_role(auth.uid(),'DP_ACADEMICS')
    OR public.has_role(auth.uid(),'IQA')
    OR public.has_role(auth.uid(),'SUPER_ADMIN')
  );

-- Restrict system_settings read: hide locked_by_email/locked_by from non-admins by
-- limiting direct row reads to Super Admin, and expose safe lock status via RPC.
DROP POLICY IF EXISTS "Authenticated can read lock" ON public.system_settings;
CREATE POLICY "Super Admin reads full system settings"
  ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE OR REPLACE FUNCTION public.get_system_lock_public()
RETURNS TABLE(lock_active boolean, lock_reason text, locked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lock_active, lock_reason, locked_at
  FROM public.system_settings WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_system_lock_public() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_lock_public() TO authenticated;

-- Add explicit restrictive block so nobody can insert/update verifier_reviews from
-- client (only edge functions with service_role write here). This makes the
-- "no write policy" state explicit and future-proof.
CREATE POLICY "verifier_reviews_block_client_writes"
  ON public.verifier_reviews AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
ALTER TABLE public.verification_packs
  ADD COLUMN IF NOT EXISTS include_dp_approved boolean NOT NULL DEFAULT false;-- New enum values (added here, used in later migrations)
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'IQA_REVIEWED' AFTER 'HOD_APPROVED';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'Records of Work Covered';

-- Courses: department -> course -> unit
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT ALL ON public.courses TO service_role;

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read courses"
  ON public.courses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admins manage courses"
  ON public.courses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "HODs manage own department courses"
  ON public.courses FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'HOD')
    AND department = (SELECT p.department FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'HOD')
    AND department = (SELECT p.department FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link units and documents to a course
ALTER TABLE public.unit_session_config
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;

-- Onboarding checklist progress
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  step_key text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, step_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_progress TO authenticated;
GRANT ALL ON public.onboarding_progress TO service_role;

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own onboarding progress"
  ON public.onboarding_progress FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_onboarding_progress_updated_at
  BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean := (auth.uid() = OLD.trainer_id);
  is_super boolean := public.has_role(auth.uid(), 'SUPER_ADMIN');
BEGIN
  IF is_super THEN
    RETURN NEW;
  END IF;

  IF is_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('HOD_APPROVED','IQA_REVIEWED','DP_APPROVED','ARCHIVED') THEN
      RAISE EXCEPTION 'Trainers cannot approve their own documents';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.submission_type IS DISTINCT FROM OLD.submission_type
     OR NEW.department IS DISTINCT FROM OLD.department
     OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
     OR NEW.session_year IS DISTINCT FROM OLD.session_year
     OR NEW.session_term IS DISTINCT FROM OLD.session_term
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  THEN
    RAISE EXCEPTION 'Approvers may not modify document identity or payload fields';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF public.has_role(auth.uid(),'HOD') AND OLD.status = 'SUBMITTED'
       AND NEW.status IN ('HOD_APPROVED','REJECTED') THEN
      NULL;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'HOD_APPROVED'
       AND NEW.status IN ('IQA_REVIEWED','REJECTED','SUBMITTED') THEN
      -- SUBMITTED here means "return to HOD stage". Require a return_note.
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'DP_ACADEMICS') AND OLD.status = 'IQA_REVIEWED'
       AND NEW.status IN ('DP_APPROVED','REJECTED','HOD_APPROVED') THEN
      -- HOD_APPROVED here means "return to IQA review stage". Require a return_note.
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to IQA review';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','IQA_REVIEWED') THEN
      -- IQA_REVIEWED here means "return to DP stage". Require a return_note.
      IF NEW.status = 'IQA_REVIEWED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to DP';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    LEFT JOIN public.profiles p ON p.user_id = auth.uid()
    WHERE (
        (public.has_role(auth.uid(), 'HOD')
          AND d.status = 'SUBMITTED'
          AND d.department = p.department)
        OR (public.has_role(auth.uid(), 'IQA')
          AND d.status IN ('HOD_APPROVED','DP_APPROVED'))
        OR (public.has_role(auth.uid(), 'DP_ACADEMICS')
          AND d.status = 'IQA_REVIEWED')
      )
      -- Exact path structure: <trainer_id>/<assignment_id-or-'unassigned'>/stamped_*.pdf
      AND split_part(_path, '/', 1) = d.trainer_id::text
      AND split_part(_path, '/', 2) = COALESCE(d.assignment_id::text, 'unassigned')
      AND split_part(_path, '/', 3) LIKE 'stamped\_%' ESCAPE '\'
      AND split_part(_path, '/', 3) <> ''
      AND split_part(_path, '/', 4) = ''
  );
$function$;ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS iqa_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS iqa_reviewed_by uuid;CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  kind text NOT NULL,
  stage text,
  stage_order integer,
  stage_total integer,
  stamp_version text,
  layout_version text,
  title text NOT NULL,
  message text,
  note text,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Authenticated users can create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE TABLE public.stamp_layouts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_title text NOT NULL DEFAULT 'DOCUMENT APPROVAL & VERIFICATION SHEET',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stamp_layouts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stamp_layouts TO authenticated;
GRANT ALL ON public.stamp_layouts TO service_role;

ALTER TABLE public.stamp_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read stamp layouts"
  ON public.stamp_layouts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admins manage stamp layouts insert"
  ON public.stamp_layouts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins manage stamp layouts update"
  ON public.stamp_layouts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins manage stamp layouts delete"
  ON public.stamp_layouts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER trg_stamp_layouts_updated_at
  BEFORE UPDATE ON public.stamp_layouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.stamp_layouts (name, version, is_active, stages)
VALUES (
  'Standard 2026', 1, true,
  '[
    {"stage":"HOD","order":1,"title":"1. VERIFIED BY HEAD OF DEPARTMENT","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10},
    {"stage":"IQA_REVIEW","order":2,"title":"2. VERIFIED BY INTERNAL QUALITY ASSURANCE","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10},
    {"stage":"DP","order":3,"title":"3. APPROVED BY DEPUTY PRINCIPAL - ACADEMICS","slot_height":200,"sig_w":150,"sig_h":55,"stamp_size":95,"title_size":10}
  ]'::jsonb
);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS stamp_layout_version text,
  ADD COLUMN IF NOT EXISTS stamp_stage_order integer;DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;

CREATE POLICY "Approvers notify document owners"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR (
    (
      public.has_role(auth.uid(), 'HOD')
      OR public.has_role(auth.uid(), 'IQA')
      OR public.has_role(auth.uid(), 'DP_ACADEMICS')
      OR public.has_role(auth.uid(), 'SUPER_ADMIN')
    )
    AND document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = notifications.document_id
        AND d.trainer_id = notifications.user_id
    )
  )
);

CREATE POLICY "Super admins can delete verification packs"
ON public.verification_packs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

GRANT DELETE ON public.verification_packs TO authenticated;CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_table text,
  target_id text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read security events"
ON public.security_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE INDEX idx_security_events_created_at ON public.security_events (created_at DESC);ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_file_url text,
  ADD COLUMN IF NOT EXISTS rejection_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rejected_stage text,
  ADD COLUMN IF NOT EXISTS last_rejected_by uuid,
  ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rejection_reason text,
  ADD COLUMN IF NOT EXISTS resubmission_note text;

CREATE TABLE IF NOT EXISTS public.document_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  stage text NOT NULL,
  reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  document_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_rejections TO authenticated;
GRANT ALL ON public.document_rejections TO service_role;

ALTER TABLE public.document_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View rejection history for visible documents"
ON public.document_rejections FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id
      AND (
        d.trainer_id = auth.uid()
        OR public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'IQA')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'SUPER_ADMIN')
      )
  )
);

CREATE POLICY "Approvers record rejections"
ON public.document_rejections FOR INSERT TO authenticated
WITH CHECK (
  rejected_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'HOD')
    OR public.has_role(auth.uid(), 'IQA')
    OR public.has_role(auth.uid(), 'DP_ACADEMICS')
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
);

CREATE INDEX IF NOT EXISTS document_rejections_document_idx ON public.document_rejections(document_id, created_at DESC);CREATE UNIQUE INDEX IF NOT EXISTS documents_one_workload_per_session
  ON public.documents (trainer_id, session_year, session_term)
  WHERE document_type = 'Workload Allocation'::public.document_type
    AND status <> 'REJECTED'::public.document_status;