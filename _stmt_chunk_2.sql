
CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Super admins can insert roles" ON public.user_roles;
CREATE POLICY "Super admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Super admins can update roles" ON public.user_roles;
CREATE POLICY "Super admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Super admins can delete roles" ON public.user_roles;
CREATE POLICY "Super admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can update any profile" ON public.profiles;
CREATE POLICY "Super admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

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

DROP POLICY IF EXISTS "Super admins view role audit" ON public.role_change_audit;
CREATE POLICY "Super admins view role audit" ON public.role_change_audit
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'::app_role) OR public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

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

DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

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

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();


CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count int;
  target_uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  SELECT count(*) INTO existing_count FROM public.user_roles WHERE role = 'SUPER_ADMIN';
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Super Admin already configured';
  END IF;
  SELECT user_id INTO target_uid FROM public.profiles WHERE lower(email) = lower(target_email) LIMIT 1;
  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %', target_email;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_uid, 'SUPER_ADMIN')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('user_id', target_uid, 'email', target_email);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_super_admin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(text) TO authenticated;


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
DROP TRIGGER IF EXISTS trg_protect_stamp_dates ON UPDATE;
CREATE TRIGGER trg_protect_stamp_dates
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.protect_stamp_dates();

-- 5. SUPER_ADMIN write policies on user_roles (DP already has; add SA mirror just in case)
-- (Already exist per schema dump; no-op safety)

-- 6. SUPER_ADMIN can update/insert profiles (already allowed update; ensure insert)
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
CREATE POLICY "Super admins can insert any profile" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Storage policies: backups bucket — Super Admin only
DROP POLICY IF EXISTS "Super admins read backups" ON storage.objects;
CREATE POLICY "Super admins read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins write backups" ON storage.objects;
CREATE POLICY "Super admins write backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins update backups" ON storage.objects;
CREATE POLICY "Super admins update backups"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins delete backups" ON storage.objects;
CREATE POLICY "Super admins delete backups"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Google Drive mirror fields on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_file_id text,
  ADD COLUMN IF NOT EXISTS gdrive_web_view_link text;

-- Backup metadata table
CREATE TABLE IF NOT EXISTS public.backup_metadata (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  documents_count integer DEFAULT 0,
  audit_logs_count integer DEFAULT 0,
  storage_files_count integer DEFAULT 0,
  total_bytes bigint DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_metadata TO authenticated;
GRANT ALL ON public.backup_metadata TO service_role;

ALTER TABLE public.backup_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage backup metadata" ON public.backup_metadata;
CREATE POLICY "Super admins manage backup metadata"
ON public.backup_metadata FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));