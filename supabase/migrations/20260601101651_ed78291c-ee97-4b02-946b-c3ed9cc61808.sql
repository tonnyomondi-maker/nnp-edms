CREATE POLICY "Authenticated can insert own audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (performed_by = auth.uid());

GRANT INSERT ON public.audit_logs TO authenticated;