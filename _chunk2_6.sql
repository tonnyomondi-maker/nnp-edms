      OR public.has_role(auth.uid(), 'SUPER_ADMIN')
    )
    AND document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = notifications.document_id
        AND d.trainer_id = notifications.user_id
    )
  )
);

CREATE POLICY "Super admins can delete verification packs"
ON public.verification_packs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

GRANT DELETE ON public.verification_packs TO authenticated;CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_table text,
  target_id text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read security events"
ON public.security_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE INDEX idx_security_events_created_at ON public.security_events (created_at DESC);ALTER TABLE public.documents
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

CREATE INDEX IF NOT EXISTS document_rejections_document_idx ON public.document_rejections(document_id, created_at DESC);CREATE UNIQUE INDEX IF NOT EXISTS documents_one_workload_per_session
  ON public.documents (trainer_id, session_year, session_term)
  WHERE document_type = 'Workload Allocation'::public.document_type
    AND status <> 'REJECTED'::public.document_status;