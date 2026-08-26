-- NNP ADMS flow hardening: indexes supporting trainer/approver queues and reports.
-- Safe to apply repeatedly.
CREATE INDEX IF NOT EXISTS idx_documents_trainer_session_status
  ON public.documents(trainer_id, session_year, session_term, status);

CREATE INDEX IF NOT EXISTS idx_documents_department_session_status
  ON public.documents(department, session_year, session_term, status);

CREATE INDEX IF NOT EXISTS idx_documents_session_type_unit
  ON public.documents(session_year, session_term, document_type, unit_code);

CREATE INDEX IF NOT EXISTS idx_documents_gdrive_file_id
  ON public.documents(gdrive_file_id)
  WHERE gdrive_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unit_session_config_trainer_session
  ON public.unit_session_config(trainer_id, session_year, session_term);
