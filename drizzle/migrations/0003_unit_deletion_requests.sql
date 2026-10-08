CREATE TABLE public.unit_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL,
  trainer_id uuid NOT NULL,
  department text NOT NULL,
  unit_code text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX unit_deletion_requests_one_pending ON public.unit_deletion_requests(config_id) WHERE status = 'PENDING';
GRANT SELECT ON public.unit_deletion_requests TO authenticated;
GRANT ALL ON public.unit_deletion_requests TO service_role;
ALTER TABLE public.unit_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trainer sees own requests" ON public.unit_deletion_requests FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());
CREATE POLICY "HOD sees department requests" ON public.unit_deletion_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'HOD') AND department = (SELECT p.department FROM public.profiles p WHERE p.user_id = auth.uid()));
CREATE POLICY "Super admin sees all requests" ON public.unit_deletion_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE OR REPLACE FUNCTION public.request_unit_deletion(_config_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; rid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Please give a reason (min 5 characters)'; END IF;
  SELECT * INTO c FROM unit_session_config WHERE id = _config_id AND trainer_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found'; END IF;
  IF EXISTS (SELECT 1 FROM unit_deletion_requests WHERE config_id = _config_id AND status = 'PENDING') THEN
    RAISE EXCEPTION 'A removal request for this unit is already waiting for your HOD';
  END IF;
  INSERT INTO unit_deletion_requests(config_id, trainer_id, department, unit_code, reason)
  VALUES (_config_id, auth.uid(), c.department, c.unit_code, trim(_reason)) RETURNING id INTO rid;
  INSERT INTO audit_logs(action, performed_by, details) VALUES ('UNIT_DELETION_REQUESTED', auth.uid(),
    jsonb_build_object('request_id', rid, 'unit_code', c.unit_code, 'department', c.department, 'reason', trim(_reason)));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_unit_deletion_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE unit_deletion_requests SET status='CANCELLED', decided_by=auth.uid(), decided_at=now()
  WHERE id=_request_id AND trainer_id=auth.uid() AND status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.dismiss_unit_deletion_request(_request_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; my_dept text;
BEGIN
  SELECT * INTO r FROM unit_deletion_requests WHERE id=_request_id AND status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.has_role(auth.uid(),'SUPER_ADMIN') THEN
    SELECT department INTO my_dept FROM profiles WHERE user_id = auth.uid();
    IF NOT public.has_role(auth.uid(),'HOD') OR my_dept IS DISTINCT FROM r.department THEN
      RAISE EXCEPTION 'Not authorised';
    END IF;
  END IF;
  UPDATE unit_deletion_requests SET status='DISMISSED', decided_by=auth.uid(), decided_at=now(), decision_note=_note WHERE id=_request_id;
  INSERT INTO audit_logs(action, performed_by, details) VALUES ('UNIT_DELETION_DISMISSED', auth.uid(),
    jsonb_build_object('request_id', _request_id, 'unit_code', r.unit_code, 'note', _note));
END $$;

CREATE OR REPLACE FUNCTION public.delete_unit_allocation(_config_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c record; my_dept text; doc_count int; req_id uuid; is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Please give a reason (min 5 characters)'; END IF;
  SELECT * INTO c FROM unit_session_config WHERE id = _config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found'; END IF;
  is_admin := public.has_role(auth.uid(),'SUPER_ADMIN');
  SELECT id INTO req_id FROM unit_deletion_requests WHERE config_id=_config_id AND status='PENDING' LIMIT 1;
  IF NOT is_admin THEN
    SELECT department INTO my_dept FROM profiles WHERE user_id = auth.uid();
    IF NOT public.has_role(auth.uid(),'HOD') OR my_dept IS DISTINCT FROM c.department THEN
      RAISE EXCEPTION 'Only the HOD of % or the System Administrator can remove this unit', c.department;
    END IF;
    IF req_id IS NULL THEN
      RAISE EXCEPTION 'The trainer must request removal of this unit first';
    END IF;
  END IF;
  SELECT count(*) INTO doc_count FROM documents
   WHERE trainer_id = c.trainer_id AND unit_code = c.unit_code
     AND session_year = c.session_year AND session_term = c.session_term;
  IF req_id IS NOT NULL THEN
    UPDATE unit_deletion_requests SET status='APPROVED', decided_by=auth.uid(), decided_at=now(), decision_note=trim(_reason) WHERE id=req_id;
  END IF;
  DELETE FROM unit_session_config WHERE id = _config_id;
  INSERT INTO audit_logs(action, performed_by, details) VALUES ('UNIT_ALLOCATION_DELETED', auth.uid(),
    jsonb_build_object('trainer_id', c.trainer_id, 'unit_code', c.unit_code, 'unit_name', c.unit_name,
      'department', c.department, 'session_year', c.session_year, 'session_term', c.session_term,
      'reason', trim(_reason), 'documents_kept', doc_count, 'request_id', req_id,
      'admin_override', is_admin AND req_id IS NULL));
  RETURN jsonb_build_object('deleted', true, 'documents_kept', doc_count);
END $function$;

REVOKE EXECUTE ON FUNCTION public.request_unit_deletion(uuid,text), public.cancel_unit_deletion_request(uuid), public.dismiss_unit_deletion_request(uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.request_unit_deletion(uuid,text), public.cancel_unit_deletion_request(uuid), public.dismiss_unit_deletion_request(uuid,text) TO authenticated;