
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_tier text NOT NULL DEFAULT 'cloud'
    CHECK (storage_tier IN ('cloud','drive','both')),
  ADD COLUMN IF NOT EXISTS drive_offloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_offloaded_by uuid;

CREATE INDEX IF NOT EXISTS idx_documents_storage_tier ON public.documents(storage_tier);
CREATE INDEX IF NOT EXISTS idx_documents_dept_trainer ON public.documents(department, trainer_id);
