-- Add EXPORTED status to enum
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'EXPORTED';

-- Add export tracking columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_by UUID;

CREATE INDEX IF NOT EXISTS idx_documents_archived_at ON public.documents(archived_at);
CREATE INDEX IF NOT EXISTS idx_documents_exported_at ON public.documents(exported_at);