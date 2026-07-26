
-- Restrict department_pack_capacity read to IQA / Super Admin (writers already scoped)
DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "IQA and admins read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

-- Restrict sla_targets read to approver roles + Super Admin
DROP POLICY IF EXISTS "sla_targets_read_all" ON public.sla_targets;
CREATE POLICY "sla_targets_read_privileged"
  ON public.sla_targets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'HOD')
    OR public.has_role(auth.uid(),'DP_ACADEMICS')
    OR public.has_role(auth.uid(),'IQA')
    OR public.has_role(auth.uid(),'SUPER_ADMIN')
  );

-- Restrict system_settings read: hide locked_by_email/locked_by from non-admins by
-- limiting direct row reads to Super Admin, and expose safe lock status via RPC.
DROP POLICY IF EXISTS "Authenticated can read lock" ON public.system_settings;
CREATE POLICY "Super Admin reads full system settings"
  ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'SUPER_ADMIN'));

CREATE OR REPLACE FUNCTION public.get_system_lock_public()
RETURNS TABLE(lock_active boolean, lock_reason text, locked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lock_active, lock_reason, locked_at
  FROM public.system_settings WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_system_lock_public() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_lock_public() TO authenticated;

-- Add explicit restrictive block so nobody can insert/update verifier_reviews from
-- client (only edge functions with service_role write here). This makes the
-- "no write policy" state explicit and future-proof.
CREATE POLICY "verifier_reviews_block_client_writes"
  ON public.verifier_reviews AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
