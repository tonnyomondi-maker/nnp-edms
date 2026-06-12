CREATE TABLE public.document_type_policy (
  document_type public.document_type PRIMARY KEY,
  signature_only_allowed boolean NOT NULL DEFAULT false,
  stamp_required boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_type_policy TO authenticated;
GRANT ALL ON public.document_type_policy TO service_role;

ALTER TABLE public.document_type_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read approval policies"
  ON public.document_type_policy FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super Admin can insert policies"
  ON public.document_type_policy FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super Admin can update policies"
  ON public.document_type_policy FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super Admin can delete policies"
  ON public.document_type_policy FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE TRIGGER document_type_policy_updated_at
  BEFORE UPDATE ON public.document_type_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed defaults: weekly docs allow signature-only; one-time formal docs require stamp.
INSERT INTO public.document_type_policy (document_type, signature_only_allowed, stamp_required, notes) VALUES
  ('Class Attendance',     true,  false, 'Weekly attendance — signature alone is sufficient.'),
  ('Session Plan',         true,  false, 'Weekly session plan — signature alone is sufficient.'),
  ('Learning Plan',        false, true,  'One-time formal document — stamp required.'),
  ('Personal Timetable',   false, true,  'One-time formal document — stamp required.'),
  ('Workload Allocation',  false, true,  'One-time formal document — stamp required.'),
  ('Scheme of Work',       false, true,  'One-time formal document — stamp required.'),
  ('Course Outline',       false, true,  'One-time formal document — stamp required.')
ON CONFLICT (document_type) DO NOTHING;