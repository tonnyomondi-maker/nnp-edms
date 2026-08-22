    COALESCE(SUM(vp.download_count),0)::bigint,
    MIN(vp.expires_at) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now()),
    COALESCE(dpc.active_pack_limit, _capacity)::int,
    GREATEST(0, COALESCE(dpc.active_pack_limit, _capacity) - COUNT(*) FILTER (WHERE vp.revoked_at IS NULL AND vp.expires_at > now())::int)
  FROM public.verification_packs vp
  LEFT JOIN public.department_pack_capacity dpc ON dpc.department = vp.department
  GROUP BY vp.department, dpc.active_pack_limit
  ORDER BY vp.department;
$$;

CREATE OR REPLACE FUNCTION public.document_pack_timeline(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc record;
  events jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT id, department, session_year, session_term
    INTO doc FROM public.documents WHERE id = _document_id;
  IF NOT FOUND THEN RETURN events; END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')::timestamptz), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('ts', vp.created_at, 'kind', 'pack_created',
      'meta', jsonb_build_object('pack_id', vp.id, 'token', vp.token)) AS e
    FROM public.verification_packs vp
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', vp.revoked_at, 'kind', 'pack_revoked',
      'meta', jsonb_build_object('pack_id', vp.id))
    FROM public.verification_packs vp
    WHERE vp.revoked_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.assigned_at, 'kind', 'verifier_assigned',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.first_opened_at, 'kind', 'pack_opened',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id, 'verifier_name', v.full_name))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.first_opened_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.reminder_sent_at, 'kind', 'reminder_sent',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.reminder_sent_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', al.created_at, 'kind', al.action, 'meta', al.details)
    FROM public.audit_logs al
    WHERE al.action IN ('PACK_DOWNLOADED','PACK_OPENED')
      AND (al.details->>'pack_id') IN (
        SELECT id::text FROM public.verification_packs
        WHERE department = doc.department AND session_year = doc.session_year AND session_term = doc.session_term)
    UNION ALL
    SELECT jsonb_build_object('ts', r.reviewed_at, 'kind', 'review_submitted',
      'meta', jsonb_build_object('pack_id', r.pack_id, 'verifier_id', r.verifier_id,
        'decision', r.decision, 'notes', r.notes, 'verifier_name', v.full_name))
    FROM public.verifier_reviews r
    LEFT JOIN public.verifiers v ON v.id = r.verifier_id
    WHERE r.document_id = _document_id
  ) sub WHERE e->>'ts' IS NOT NULL;

  RETURN events;
END;
$$;

REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.document_pack_timeline(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.document_pack_timeline(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.document_pack_timeline(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc record;
  events jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT id, department, session_year, session_term
    INTO doc FROM public.documents WHERE id = _document_id;
  IF NOT FOUND THEN RETURN events; END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')::timestamptz), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('ts', vp.created_at, 'kind', 'pack_created',
      'meta', jsonb_build_object('pack_id', vp.id, 'token', vp.token)) AS e
    FROM public.verification_packs vp
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', vp.revoked_at, 'kind', 'pack_revoked',
      'meta', jsonb_build_object('pack_id', vp.id))
    FROM public.verification_packs vp
    WHERE vp.revoked_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.assigned_at, 'kind', 'verifier_assigned',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE vp.department = doc.department AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.first_opened_at, 'kind', 'pack_opened',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id, 'verifier_name', v.full_name))
    FROM public.verification_pack_assignees a
    JOIN public.verification_packs vp ON vp.id = a.pack_id
    LEFT JOIN public.verifiers v ON v.id = a.verifier_id
    WHERE a.first_opened_at IS NOT NULL AND vp.department = doc.department
      AND vp.session_year = doc.session_year AND vp.session_term = doc.session_term
    UNION ALL
    SELECT jsonb_build_object('ts', a.reminder_sent_at, 'kind', 'reminder_sent',
      'meta', jsonb_build_object('pack_id', a.pack_id, 'verifier_id', a.verifier_id,
        'verifier_name', v.full_name, 'verifier_email', v.email))