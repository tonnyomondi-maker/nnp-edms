
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
