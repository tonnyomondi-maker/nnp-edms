
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
