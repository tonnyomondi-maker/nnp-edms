ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS gdrive_last_error text,
  ADD COLUMN IF NOT EXISTS gdrive_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS gdrive_attempt_count integer NOT NULL DEFAULT 0;

UPDATE public.documents SET gdrive_sync_status = 'success' WHERE gdrive_file_id IS NOT NULL AND gdrive_sync_status <> 'success';