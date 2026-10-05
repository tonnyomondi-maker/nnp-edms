CREATE OR REPLACE FUNCTION public.lock_profile_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.department IS DISTINCT FROM OLD.department
     AND COALESCE(btrim(OLD.department), '') <> ''
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Your home department is locked. Contact the System Administrator to change it.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_profile_department() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lock_profile_department_trg ON public.profiles;
CREATE TRIGGER lock_profile_department_trg
BEFORE UPDATE OF department ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.lock_profile_department();