
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
