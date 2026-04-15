
-- Drop overly permissive audit_logs insert policy
DROP POLICY "System can insert audit logs" ON public.audit_logs;

-- The audit log trigger uses SECURITY DEFINER so it bypasses RLS.
-- No insert policy needed for regular users - only triggers insert.

-- Drop duplicate permissive user_roles policy
DROP POLICY "Admins can view all roles" ON public.user_roles;
