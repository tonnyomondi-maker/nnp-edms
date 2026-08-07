CREATE TABLE public.security_events (
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

CREATE INDEX idx_security_events_created_at ON public.security_events (created_at DESC);