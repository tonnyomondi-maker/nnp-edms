CREATE UNIQUE INDEX IF NOT EXISTS documents_one_workload_per_session
  ON public.documents (trainer_id, session_year, session_term)
  WHERE document_type = 'Workload Allocation'::public.document_type
    AND status <> 'REJECTED'::public.document_status;