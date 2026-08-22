       AND NEW.status IN ('DP_APPROVED','REJECTED','SUBMITTED') THEN
      -- SUBMITTED here means "return to HOD stage". Require a return_note.
      IF NEW.status = 'SUBMITTED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to HOD';
      END IF;
    ELSIF public.has_role(auth.uid(),'IQA') AND OLD.status = 'DP_APPROVED'
       AND NEW.status IN ('ARCHIVED','REJECTED','HOD_APPROVED') THEN
      -- HOD_APPROVED here means "return to DP stage". Require a return_note.
      IF NEW.status = 'HOD_APPROVED' AND (NEW.return_note IS NULL OR length(trim(NEW.return_note)) < 5) THEN
        RAISE EXCEPTION 'A return note (min 5 chars) is required when sending back to DP';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


REVOKE EXECUTE ON FUNCTION public.enforce_single_current_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;


DROP POLICY IF EXISTS "Templates readable by any signed-in user" ON storage.objects;
CREATE POLICY "Templates readable by any signed-in user"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'templates');

DROP POLICY IF EXISTS "Super Admin writes templates" ON storage.objects;
CREATE POLICY "Super Admin writes templates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super Admin updates templates" ON storage.objects;
CREATE POLICY "Super Admin updates templates"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'))
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super Admin deletes templates" ON storage.objects;
CREATE POLICY "Super Admin deletes templates"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(),'SUPER_ADMIN'));


CREATE TABLE IF NOT EXISTS public.sla_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type public.document_type NOT NULL,
  stage text NOT NULL CHECK (stage IN ('HOD','DP','IQA')),
  target_hours integer NOT NULL CHECK (target_hours > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (document_type, stage)
);

GRANT SELECT ON public.sla_targets TO authenticated;
GRANT ALL ON public.sla_targets TO service_role;

ALTER TABLE public.sla_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sla_targets_read_all" ON public.sla_targets;
CREATE POLICY "sla_targets_read_all"
  ON public.sla_targets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sla_targets_super_admin_write" ON public.sla_targets;
CREATE POLICY "sla_targets_super_admin_write"
  ON public.sla_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP TRIGGER IF EXISTS sla_targets_updated_at ON UPDATE;
CREATE TRIGGER sla_targets_updated_at
  BEFORE UPDATE ON public.sla_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Restrict department_pack_capacity read to IQA / Super Admin (writers already scoped)
DROP POLICY IF EXISTS "Auth users can read department pack capacity" ON public.department_pack_capacity;
DROP POLICY IF EXISTS "IQA and admins read department pack capacity" ON public.department_pack_capacity;
CREATE POLICY "IQA and admins read department pack capacity"
  ON public.department_pack_capacity FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'IQA') OR public.has_role(auth.uid(),'SUPER_ADMIN'));

-- Restrict sla_targets read to approver roles + Super Admin
DROP POLICY IF EXISTS "sla_targets_read_all" ON public.sla_targets;
DROP POLICY IF EXISTS "sla_targets_read_privileged" ON public.sla_targets;
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
DROP POLICY IF EXISTS "Super Admin reads full system settings" ON public.system_settings;
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
DROP POLICY IF EXISTS "verifier_reviews_block_client_writes" ON public.verifier_reviews;
CREATE POLICY "verifier_reviews_block_client_writes"
  ON public.verifier_reviews AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

ALTER TABLE public.verification_packs
  ADD COLUMN IF NOT EXISTS include_dp_approved boolean NOT NULL DEFAULT false;
-- New enum values (added here, used in later migrations)
ALTER TYPE public.document_status ADD VALUE IF NOT EXISTS 'IQA_REVIEWED' AFTER 'HOD_APPROVED';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'Records of Work Covered';

-- Courses: department -> course -> unit
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT ALL ON public.courses TO service_role;

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read courses" ON public.courses;
CREATE POLICY "Authenticated can read courses"
  ON public.courses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admins manage courses" ON public.courses;