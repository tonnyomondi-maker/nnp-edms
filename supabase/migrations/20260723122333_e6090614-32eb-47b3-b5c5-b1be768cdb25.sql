
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
