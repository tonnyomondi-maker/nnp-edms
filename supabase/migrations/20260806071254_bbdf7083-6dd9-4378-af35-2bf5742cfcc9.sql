CREATE TABLE public.notifications (
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
  ADD COLUMN IF NOT EXISTS stamp_stage_order integer;