CREATE OR REPLACE FUNCTION public.guard_document_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_owner boolean := (auth.uid() = OLD.trainer_id);
  is_super boolean := public.has_role(auth.uid(), 'SUPER_ADMIN');
  is_service boolean := (coalesce(current_setting('request.jwt.claim.role', true),
                                  (current_setting('request.jwt.claims', true)::jsonb->>'role'),
                                  '') = 'service_role')
                        OR auth.uid() IS NULL;
BEGIN
  IF is_service OR is_super THEN
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
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'DP_ACADEMICS') AND OLD.status = 'IQA_REVIEWED'
       AND NEW.status IN ('DP_APPROVED','REJECTED','HOD_APPROVED') THEN
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to IQA review';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','IQA_REVIEWED') THEN
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

-- Repair documents whose file already reached Google Drive but was never linked
WITH latest AS (
  SELECT DISTINCT ON (document_id) document_id, details->>'file_id' AS file_id
  FROM public.audit_logs
  WHERE action = 'GDRIVE_PRIMARY_UPLOAD' AND document_id IS NOT NULL
  ORDER BY document_id, created_at DESC
)
UPDATE public.documents d
SET gdrive_file_id = latest.file_id,
    file_drive_id = latest.file_id,
    file_url = 'gdrive://' || latest.file_id,
    storage_tier = 'drive',
    gdrive_sync_status = 'success'
FROM latest
WHERE d.id = latest.document_id
  AND d.gdrive_file_id IS NULL
  AND latest.file_id IS NOT NULL;