CREATE OR REPLACE FUNCTION public.delete_unit_allocation(_config_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; my_dept text; doc_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Please give a reason (min 5 characters)'; END IF;
  SELECT * INTO c FROM unit_session_config WHERE id = _config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found'; END IF;
  IF NOT public.has_role(auth.uid(),'SUPER_ADMIN') THEN
    SELECT department INTO my_dept FROM profiles WHERE user_id = auth.uid();
    IF NOT public.has_role(auth.uid(),'HOD') OR my_dept IS DISTINCT FROM c.department THEN
      RAISE EXCEPTION 'Only the HOD of % or the System Administrator can remove this unit', c.department;
    END IF;
  END IF;
  SELECT count(*) INTO doc_count FROM documents
   WHERE trainer_id = c.trainer_id AND unit_code = c.unit_code
     AND session_year = c.session_year AND session_term = c.session_term;
  DELETE FROM unit_session_config WHERE id = _config_id;
  INSERT INTO audit_logs(action, performed_by, details) VALUES ('UNIT_ALLOCATION_DELETED', auth.uid(),
    jsonb_build_object('trainer_id', c.trainer_id, 'unit_code', c.unit_code, 'unit_name', c.unit_name,
      'department', c.department, 'session_year', c.session_year, 'session_term', c.session_term,
      'reason', trim(_reason), 'documents_kept', doc_count));
  RETURN jsonb_build_object('deleted', true, 'documents_kept', doc_count);
END $$;
REVOKE ALL ON FUNCTION public.delete_unit_allocation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_unit_allocation(uuid, text) TO authenticated;