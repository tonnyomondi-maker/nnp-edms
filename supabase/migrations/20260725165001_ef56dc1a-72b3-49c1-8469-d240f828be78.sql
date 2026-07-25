
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
