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