CREATE TABLE public.exam_committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  section text,
  name text NOT NULL,
  session_year integer NOT NULL,
  session_term text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.exam_committee_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id uuid NOT NULL REFERENCES public.exam_committees(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_chair boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (committee_id, user_id)
);
CREATE TABLE public.exam_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL,
  department text NOT NULL,
  section text,
  unit_code text NOT NULL,
  unit_name text,
  class_code text,
  paper_type text NOT NULL,
  session_year integer NOT NULL,
  session_term text NOT NULL,
  committee_id uuid REFERENCES public.exam_committees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'SUBMITTED',
  version integer NOT NULL DEFAULT 1,
  paper_path text NOT NULL,
  scheme_path text,
  rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  committee_minutes text,
  hod_note text,
  iqa_note text,
  return_reason text,
  returned_stage text,
  committee_endorsed_at timestamptz,
  hod_endorsed_by uuid, hod_endorsed_at timestamptz,
  iqa_cleared_by uuid, iqa_cleared_at timestamptz,
  received_by uuid, received_at timestamptz,
  gdrive_file_id text, gdrive_scheme_id text, gdrive_status text NOT NULL DEFAULT 'NOT_SYNCED', gdrive_error text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_paper_type_chk CHECK (paper_type IN ('MAIN','SUPPLEMENTARY','CAT1','CAT2')),
  CONSTRAINT exam_status_chk CHECK (status IN ('SUBMITTED','COMMITTEE_ENDORSED','HOD_ENDORSED','IQA_CLEARED','RECEIVED','RETURNED'))
);
CREATE TABLE public.exam_paper_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.exam_paper_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  version integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE','RETURN')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, member_id, version)
);
CREATE TABLE public.exam_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid,
  user_id uuid,
  user_email text,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_committees, public.exam_committee_members TO authenticated;
GRANT SELECT ON public.exam_papers, public.exam_paper_notes, public.exam_paper_signoffs, public.exam_access_logs TO authenticated;
GRANT ALL ON public.exam_committees, public.exam_committee_members, public.exam_papers, public.exam_paper_notes, public.exam_paper_signoffs, public.exam_access_logs TO service_role;

ALTER TABLE public.exam_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_committee_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_paper_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_paper_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_access_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_department() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT department FROM public.profiles WHERE user_id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.is_exam_committee_member(_committee_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.exam_committee_members WHERE committee_id=_committee_id AND user_id=auth.uid()) $$;

-- Who may see an exam paper (metadata and watermarked content)
CREATE OR REPLACE FUNCTION public.can_access_exam_paper(_paper_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_papers p WHERE p.id=_paper_id AND (
      p.trainer_id = auth.uid()
      OR (p.committee_id IS NOT NULL AND public.is_exam_committee_member(p.committee_id))
      OR (public.has_role(auth.uid(),'HOD') AND p.department = public.my_department())
      OR (public.has_role(auth.uid(),'IQA') AND p.status IN ('HOD_ENDORSED','IQA_CLEARED','RECEIVED'))
      OR (public.has_role(auth.uid(),'EXAMS_OFFICE') AND p.status IN ('IQA_CLEARED','RECEIVED'))
    )) $$;

CREATE POLICY "exam papers visible to workflow participants" ON public.exam_papers FOR SELECT TO authenticated USING (public.can_access_exam_paper(id));
CREATE POLICY "exam notes visible to participants" ON public.exam_paper_notes FOR SELECT TO authenticated USING (public.can_access_exam_paper(paper_id));
CREATE POLICY "exam signoffs visible to participants" ON public.exam_paper_signoffs FOR SELECT TO authenticated USING (public.can_access_exam_paper(paper_id));
CREATE POLICY "exam access logs for HOD IQA admin" ON public.exam_access_logs FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'SUPER_ADMIN') OR public.has_role(auth.uid(),'IQA')
  OR (public.has_role(auth.uid(),'HOD') AND EXISTS (SELECT 1 FROM public.exam_papers p WHERE p.id=paper_id AND p.department=public.my_department())));

CREATE POLICY "committees visible" ON public.exam_committees FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'SUPER_ADMIN') OR public.has_role(auth.uid(),'IQA')
  OR department = public.my_department() OR public.is_exam_committee_member(id));
CREATE POLICY "HOD manages own department committees" ON public.exam_committees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'HOD') AND department = public.my_department())
  WITH CHECK (public.has_role(auth.uid(),'HOD') AND department = public.my_department());
CREATE POLICY "committee members visible" ON public.exam_committee_members FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.exam_committees c WHERE c.id=committee_id AND (
    public.has_role(auth.uid(),'SUPER_ADMIN') OR public.has_role(auth.uid(),'IQA') OR c.department = public.my_department()))
  OR user_id = auth.uid());
CREATE POLICY "HOD manages committee members" ON public.exam_committee_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_committees c WHERE c.id=committee_id AND public.has_role(auth.uid(),'HOD') AND c.department=public.my_department()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.exam_committees c WHERE c.id=committee_id AND public.has_role(auth.uid(),'HOD') AND c.department=public.my_department()));

CREATE TRIGGER exam_papers_updated_at BEFORE UPDATE ON public.exam_papers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Committee shared workspace
CREATE OR REPLACE FUNCTION public.exam_add_note(_paper_id uuid, _body text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE nm text;
BEGIN
  IF NOT public.can_access_exam_paper(_paper_id) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF coalesce(length(trim(_body)),0) < 2 THEN RAISE EXCEPTION 'Note is empty'; END IF;
  SELECT full_name INTO nm FROM profiles WHERE user_id=auth.uid();
  INSERT INTO exam_paper_notes(paper_id, author_id, author_name, body) VALUES (_paper_id, auth.uid(), nm, left(trim(_body), 4000));
END $$;

CREATE OR REPLACE FUNCTION public.exam_save_rubric(_paper_id uuid, _rubric jsonb, _minutes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM exam_papers WHERE id=_paper_id;
  IF NOT FOUND OR p.status <> 'SUBMITTED' OR p.committee_id IS NULL OR NOT public.is_exam_committee_member(p.committee_id) THEN
    RAISE EXCEPTION 'Only committee members can edit the moderation sheet while under review'; END IF;
  UPDATE exam_papers SET rubric=coalesce(_rubric,'{}'::jsonb), committee_minutes=_minutes WHERE id=_paper_id;
END $$;

CREATE OR REPLACE FUNCTION public.exam_assign_committee(_paper_id uuid, _committee_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; c record;
BEGIN
  SELECT * INTO p FROM exam_papers WHERE id=_paper_id;
  SELECT * INTO c FROM exam_committees WHERE id=_committee_id;
  IF p IS NULL OR c IS NULL OR NOT public.has_role(auth.uid(),'HOD') OR p.department <> public.my_department() OR c.department <> p.department THEN
    RAISE EXCEPTION 'Not authorised'; END IF;
  IF p.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Committee can only change while under committee review'; END IF;
  UPDATE exam_papers SET committee_id=_committee_id WHERE id=_paper_id;
  DELETE FROM exam_paper_signoffs WHERE paper_id=_paper_id AND version=p.version;
  INSERT INTO notifications(user_id, kind, title, message)
    SELECT m.user_id, 'EXAM_COMMITTEE', 'Exam paper assigned for moderation', p.unit_code || ' (' || p.paper_type || ') is waiting for your committee'
    FROM exam_committee_members m WHERE m.committee_id=_committee_id;
  INSERT INTO exam_access_logs(paper_id, user_id, action, details) VALUES (_paper_id, auth.uid(), 'COMMITTEE_ASSIGNED', jsonb_build_object('committee_id',_committee_id));
END $$;

CREATE OR REPLACE FUNCTION public.exam_committee_signoff(_paper_id uuid, _decision text, _note text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; total int; approved int;
BEGIN
  SELECT * INTO p FROM exam_papers WHERE id=_paper_id;
  IF NOT FOUND OR p.status <> 'SUBMITTED' OR p.committee_id IS NULL OR NOT public.is_exam_committee_member(p.committee_id) THEN
    RAISE EXCEPTION 'Only committee members can sign off this paper'; END IF;
  IF p.trainer_id = auth.uid() THEN RAISE EXCEPTION 'You cannot moderate your own paper'; END IF;
  IF _decision NOT IN ('APPROVE','RETURN') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _decision='RETURN' AND coalesce(length(trim(_note)),0) < 5 THEN RAISE EXCEPTION 'Give a reason (min 5 characters)'; END IF;
  INSERT INTO exam_paper_signoffs(paper_id, member_id, version, decision, note) VALUES (_paper_id, auth.uid(), p.version, _decision, _note)
    ON CONFLICT (paper_id, member_id, version) DO UPDATE SET decision=EXCLUDED.decision, note=EXCLUDED.note, created_at=now();
  INSERT INTO exam_access_logs(paper_id, user_id, action, details) VALUES (_paper_id, auth.uid(), 'COMMITTEE_'||_decision, jsonb_build_object('note',_note));
  IF _decision='RETURN' THEN
    UPDATE exam_papers SET status='RETURNED', returned_stage='COMMITTEE', return_reason=_note WHERE id=_paper_id;
    INSERT INTO notifications(user_id, kind, title, message) VALUES (p.trainer_id, 'EXAM_RETURNED', 'Exam paper returned by committee', p.unit_code || ': ' || _note);
    RETURN 'RETURNED';
  END IF;
  SELECT count(*) INTO total FROM exam_committee_members WHERE committee_id=p.committee_id AND user_id <> p.trainer_id;
  SELECT count(*) INTO approved FROM exam_paper_signoffs s JOIN exam_committee_members m ON m.user_id=s.member_id AND m.committee_id=p.committee_id
    WHERE s.paper_id=_paper_id AND s.version=p.version AND s.decision='APPROVE';
  IF approved >= total THEN
    UPDATE exam_papers SET status='COMMITTEE_ENDORSED', committee_endorsed_at=now() WHERE id=_paper_id;
    INSERT INTO notifications(user_id, kind, title, message)
      SELECT ur.user_id, 'EXAM_HOD', 'Exam paper ready for HOD endorsement', p.unit_code || ' (' || p.paper_type || ')'
      FROM user_roles ur JOIN profiles pr ON pr.user_id=ur.user_id WHERE ur.role='HOD' AND pr.department=p.department;
    RETURN 'COMMITTEE_ENDORSED';
  END IF;
  RETURN 'SIGNED';
END $$;

CREATE OR REPLACE FUNCTION public.exam_transition(_paper_id uuid, _action text, _note text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM exam_papers WHERE id=_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paper not found'; END IF;
  IF _action IN ('RETURN') AND coalesce(length(trim(_note)),0) < 5 THEN RAISE EXCEPTION 'Give a reason (min 5 characters)'; END IF;
  IF p.status='COMMITTEE_ENDORSED' AND public.has_role(auth.uid(),'HOD') AND p.department=public.my_department() THEN
    IF _action='APPROVE' THEN
      UPDATE exam_papers SET status='HOD_ENDORSED', hod_endorsed_by=auth.uid(), hod_endorsed_at=now(), hod_note=_note WHERE id=_paper_id;
      INSERT INTO notifications(user_id, kind, title, message) SELECT user_id,'EXAM_IQA','Exam paper awaiting IQAO clearance', p.department||' · '||p.unit_code FROM user_roles WHERE role='IQA';
    ELSIF _action='RETURN' THEN
      UPDATE exam_papers SET status='RETURNED', returned_stage='HOD', return_reason=_note WHERE id=_paper_id;
    ELSE RAISE EXCEPTION 'Invalid action'; END IF;
  ELSIF p.status='HOD_ENDORSED' AND public.has_role(auth.uid(),'IQA') THEN
    IF _action='APPROVE' THEN
      UPDATE exam_papers SET status='IQA_CLEARED', iqa_cleared_by=auth.uid(), iqa_cleared_at=now(), iqa_note=_note WHERE id=_paper_id;
      INSERT INTO notifications(user_id, kind, title, message) SELECT user_id,'EXAM_PRINT','Exam paper cleared for printing', p.department||' · '||p.unit_code FROM user_roles WHERE role='EXAMS_OFFICE';
    ELSIF _action='RETURN' THEN
      UPDATE exam_papers SET status='RETURNED', returned_stage='IQAO', return_reason=_note WHERE id=_paper_id;
    ELSE RAISE EXCEPTION 'Invalid action'; END IF;
  ELSIF p.status='IQA_CLEARED' AND public.has_role(auth.uid(),'EXAMS_OFFICE') AND _action='RECEIVE' THEN
    UPDATE exam_papers SET status='RECEIVED', received_by=auth.uid(), received_at=now() WHERE id=_paper_id;
  ELSE
    RAISE EXCEPTION 'This action is not allowed at stage %', p.status;
  END IF;
  IF _action='RETURN' THEN
    INSERT INTO notifications(user_id, kind, title, message) VALUES (p.trainer_id,'EXAM_RETURNED','Exam paper returned', p.unit_code||': '||_note);
  END IF;
  INSERT INTO exam_access_logs(paper_id, user_id, action, details) VALUES (_paper_id, auth.uid(), 'STAGE_'||_action, jsonb_build_object('from',p.status,'note',_note));
  RETURN 'OK';
END $$;

REVOKE EXECUTE ON FUNCTION public.exam_add_note(uuid,text), public.exam_save_rubric(uuid,jsonb,text), public.exam_assign_committee(uuid,uuid),
  public.exam_committee_signoff(uuid,text,text), public.exam_transition(uuid,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.exam_add_note(uuid,text), public.exam_save_rubric(uuid,jsonb,text), public.exam_assign_committee(uuid,uuid),
  public.exam_committee_signoff(uuid,text,text), public.exam_transition(uuid,text,text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_paper_notes;