CREATE OR REPLACE FUNCTION public.can_stamp_document_file(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.profiles p ON p.user_id = auth.uid()
    WHERE d.department = p.department
      AND (
        (public.has_role(auth.uid(), 'HOD')          AND d.status = 'SUBMITTED')
        OR (public.has_role(auth.uid(), 'DP_ACADEMICS') AND d.status = 'HOD_APPROVED')
        OR (public.has_role(auth.uid(), 'IQA')          AND d.status = 'DP_APPROVED')
      )
      -- Exact path structure: <trainer_id>/<assignment_id-or-'unassigned'>/stamped_*.pdf
      AND split_part(_path, '/', 1) = d.trainer_id::text
      AND split_part(_path, '/', 2) = COALESCE(d.assignment_id::text, 'unassigned')
      AND split_part(_path, '/', 3) LIKE 'stamped\_%' ESCAPE '\'
      AND split_part(_path, '/', 3) <> ''
      AND split_part(_path, '/', 4) = ''
  );
$function$;