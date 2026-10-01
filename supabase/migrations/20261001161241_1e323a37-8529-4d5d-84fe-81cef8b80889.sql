CREATE TABLE public.session_approver_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_year integer NOT NULL,
  session_term text NOT NULL,
  stage text NOT NULL,
  department text NOT NULL DEFAULT '',
  target integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_year, session_term, stage, department)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_approver_targets TO authenticated;
GRANT ALL ON public.session_approver_targets TO service_role;
ALTER TABLE public.session_approver_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approvers read targets" ON public.session_approver_targets FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'SUPER_ADMIN') OR public.has_role(auth.uid(),'HOD') OR public.has_role(auth.uid(),'DP_ACADEMICS') OR public.has_role(auth.uid(),'IQA'));
CREATE POLICY "Admins manage targets" ON public.session_approver_targets FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'SUPER_ADMIN')) WITH CHECK (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE OR REPLACE FUNCTION public.trainer_update_unit(
  _config_id uuid, _unit_code text, _unit_name text, _class_code text, _course_id uuid,
  _sessions_per_week integer, _course_type text, _term_number integer, _module_number integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; n integer;
BEGIN
  SELECT * INTO c FROM unit_session_config WHERE id = _config_id AND trainer_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found'; END IF;
  IF coalesce(trim(_unit_code),'') = '' THEN RAISE EXCEPTION 'Unit code is required'; END IF;
  UPDATE unit_session_config SET unit_code=trim(_unit_code), unit_name=_unit_name, class_code=_class_code,
    course_id=_course_id, sessions_per_week=greatest(1,least(7,_sessions_per_week)), course_type=_course_type,
    term_number=CASE WHEN _course_type='MODULAR' THEN NULL ELSE _term_number END,
    module_number=CASE WHEN _course_type='MODULAR' THEN _module_number ELSE NULL END,
    updated_at=now()
  WHERE id=_config_id;
  UPDATE documents SET unit_code=trim(_unit_code), unit_name=_unit_name, class_code=_class_code,
    course_id=_course_id, sessions_per_week=greatest(1,least(7,_sessions_per_week)), course_type=_course_type,
    term_number=CASE WHEN _course_type='MODULAR' THEN NULL ELSE _term_number END,
    module_number=CASE WHEN _course_type='MODULAR' THEN _module_number ELSE NULL END
  WHERE trainer_id=auth.uid() AND unit_code=c.unit_code AND session_year=c.session_year AND session_term=c.session_term;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.trainer_update_unit(uuid,text,text,text,uuid,integer,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_update_unit(uuid,text,text,text,uuid,integer,text,integer,integer) TO authenticated;