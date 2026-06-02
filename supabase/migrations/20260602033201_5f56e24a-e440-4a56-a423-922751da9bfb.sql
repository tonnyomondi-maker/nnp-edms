
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
CREATE TRIGGER trg_protect_stamp_dates
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.protect_stamp_dates();

-- 5. SUPER_ADMIN write policies on user_roles (DP already has; add SA mirror just in case)
-- (Already exist per schema dump; no-op safety)

-- 6. SUPER_ADMIN can update/insert profiles (already allowed update; ensure insert)
DROP POLICY IF EXISTS "Super admins can insert any profile" ON public.profiles;
CREATE POLICY "Super admins can insert any profile" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));
