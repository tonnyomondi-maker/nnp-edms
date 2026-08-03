ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS iqa_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS iqa_reviewed_by uuid;