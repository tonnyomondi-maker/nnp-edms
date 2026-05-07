-- 1. Allow modules 1-10
CREATE OR REPLACE FUNCTION public.validate_course_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.course_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.course_type NOT IN ('CYCLE','MODULAR') THEN
    RAISE EXCEPTION 'course_type must be CYCLE or MODULAR';
  END IF;
  IF NEW.course_type = 'MODULAR' THEN
    IF NEW.module_number IS NULL OR NEW.module_number < 1 OR NEW.module_number > 10 THEN
      RAISE EXCEPTION 'module_number 1-10 required for MODULAR course';
    END IF;
  ELSIF NEW.course_type = 'CYCLE' THEN
    IF NEW.module_number IS NOT NULL THEN
      NEW.module_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS hod_sig_w numeric,
  ADD COLUMN IF NOT EXISTS hod_sig_h numeric,
  ADD COLUMN IF NOT EXISTS hod_sig_rot integer,
  ADD COLUMN IF NOT EXISTS hod_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS hod_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS hod_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS hod_autofill boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS dp_sig_w numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_h numeric,
  ADD COLUMN IF NOT EXISTS dp_sig_rot integer,
  ADD COLUMN IF NOT EXISTS dp_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS dp_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS dp_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS dp_autofill boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS iqa_sig_w numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_h numeric,
  ADD COLUMN IF NOT EXISTS iqa_sig_rot integer,
  ADD COLUMN IF NOT EXISTS iqa_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS iqa_stamp_rot integer,
  ADD COLUMN IF NOT EXISTS iqa_stamp_opacity numeric,
  ADD COLUMN IF NOT EXISTS iqa_autofill boolean DEFAULT true;

DROP POLICY IF EXISTS "Super admins can view all roles" ON public.user_roles;
CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can insert roles" ON public.user_roles;
CREATE POLICY "Super admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update roles" ON public.user_roles;
CREATE POLICY "Super admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can delete roles" ON public.user_roles;
CREATE POLICY "Super admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super admins can update any profile" ON public.profiles;
CREATE POLICY "Super admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'));