

-- Ensure the role_change_audit table exists (idempotent)
CREATE TABLE IF NOT EXISTS public.role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_user_id uuid NOT NULL,
  target_email text,
  target_name text,
  action text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_email text
);

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

-- Ensure the audit log policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_change_audit'
      AND policyname = 'Super admins view role audit'
  ) THEN
    DROP POLICY IF EXISTS "Super admins view role audit" ON public.role_change_audit;
CREATE POLICY "Super admins view role audit" ON public.role_change_audit
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role) OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));
  END IF;
END $$;

-- Recreate the role change trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
  actor_email text;
BEGIN
  SELECT email, full_name INTO p FROM public.profiles WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) LIMIT 1;
  SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, p.email, p.full_name, 'ROLE_ADDED', NEW.role::text, auth.uid(), actor_email);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, changed_by, changed_by_email)
    VALUES (OLD.user_id, p.email, p.full_name, 'ROLE_REMOVED', OLD.role::text, auth.uid(), actor_email);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

-- Recreate the department change trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.log_department_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_email text;
BEGIN
  IF OLD.department IS DISTINCT FROM NEW.department THEN
    SELECT email INTO actor_email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    INSERT INTO public.role_change_audit(target_user_id, target_email, target_name, action, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.user_id, NEW.email, NEW.full_name, 'DEPARTMENT_CHANGED', OLD.department, NEW.department, auth.uid(), actor_email);
  END IF;
  RETURN NEW;
END;$$;

-- Create triggers if they don't exist
DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();


DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();

DROP POLICY IF EXISTS "Authenticated can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated can insert own audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (performed_by = auth.uid());

GRANT INSERT ON public.audit_logs TO authenticated;

-- 1. Pin SUPER_ADMIN bootstrap to tonny.omondi@nyamirapoly.ac.ke
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count int;
  target_uid uuid;
  allowed_email constant text := 'tonny.omondi@nyamirapoly.ac.ke';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF lower(target_email) <> allowed_email THEN
    RAISE EXCEPTION 'Only % may be promoted to Super Admin', allowed_email;
  END IF;
  SELECT count(*) INTO existing_count FROM public.user_roles WHERE role = 'SUPER_ADMIN';
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Super Admin already configured';
  END IF;
  SELECT user_id INTO target_uid FROM public.profiles WHERE lower(email) = allowed_email LIMIT 1;
  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'No user with email % — that account must sign up first', allowed_email;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_uid, 'SUPER_ADMIN')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('user_id', target_uid, 'email', allowed_email);
END;
$$;

-- 2. handle_new_user: write department + pf_number + default TRAINER role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, department, pf_number)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    NULLIF(NEW.raw_user_meta_data->>'department', ''),
    NULLIF(NEW.raw_user_meta_data->>'pf_number', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'TRAINER')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. is_test_user column on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test_user boolean NOT NULL DEFAULT false;

-- 4. Consistent stamp date fields
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS verified_by_hod_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_by_dp_academics_at timestamptz;

-- Backfill from legacy columns
UPDATE public.documents SET verified_by_hod_at = hod_approved_at WHERE verified_by_hod_at IS NULL AND hod_approved_at IS NOT NULL;
UPDATE public.documents SET approved_by_dp_academics_at = dp_approved_at WHERE approved_by_dp_academics_at IS NULL AND dp_approved_at IS NOT NULL;

-- Immutability trigger: once set, may not be changed
CREATE OR REPLACE FUNCTION public.protect_stamp_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.verified_by_hod_at IS NOT NULL AND NEW.verified_by_hod_at IS DISTINCT FROM OLD.verified_by_hod_at THEN
    NEW.verified_by_hod_at := OLD.verified_by_hod_at;
  END IF;
  IF OLD.approved_by_dp_academics_at IS NOT NULL AND NEW.approved_by_dp_academics_at IS DISTINCT FROM OLD.approved_by_dp_academics_at THEN
    NEW.approved_by_dp_academics_at := OLD.approved_by_dp_academics_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_stamp_dates ON public.documents;