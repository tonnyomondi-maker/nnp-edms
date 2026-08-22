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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_folder_map TO authenticated;
GRANT ALL ON public.drive_folder_map TO service_role;

ALTER TABLE public.drive_folder_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admin manages drive folder map" ON public.drive_folder_map;
CREATE POLICY "super admin manages drive folder map"
  ON public.drive_folder_map
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE TABLE IF NOT EXISTS public.integration_health_runs (
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

DROP POLICY IF EXISTS "super admin reads health runs" ON public.integration_health_runs;