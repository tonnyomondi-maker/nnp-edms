
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
