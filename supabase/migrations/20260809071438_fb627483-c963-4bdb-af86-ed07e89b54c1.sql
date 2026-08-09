ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_file_url text,
  ADD COLUMN IF NOT EXISTS rejection_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rejected_stage text,
  ADD COLUMN IF NOT EXISTS last_rejected_by uuid,
  ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rejection_reason text,
  ADD COLUMN IF NOT EXISTS resubmission_note text;

CREATE TABLE IF NOT EXISTS public.document_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  stage text NOT NULL,
  reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  document_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_rejections TO authenticated;
GRANT ALL ON public.document_rejections TO service_role;

ALTER TABLE public.document_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View rejection history for visible documents"
ON public.document_rejections FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id
      AND (
        d.trainer_id = auth.uid()
        OR public.has_role(auth.uid(), 'HOD')
        OR public.has_role(auth.uid(), 'IQA')
        OR public.has_role(auth.uid(), 'DP_ACADEMICS')
        OR public.has_role(auth.uid(), 'SUPER_ADMIN')
      )
  )
);

CREATE POLICY "Approvers record rejections"
ON public.document_rejections FOR INSERT TO authenticated
WITH CHECK (
  rejected_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'HOD')
    OR public.has_role(auth.uid(), 'IQA')
    OR public.has_role(auth.uid(), 'DP_ACADEMICS')
    OR public.has_role(auth.uid(), 'SUPER_ADMIN')
  )
);

CREATE INDEX IF NOT EXISTS document_rejections_document_idx ON public.document_rejections(document_id, created_at DESC);