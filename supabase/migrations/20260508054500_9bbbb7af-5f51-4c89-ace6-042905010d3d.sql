
DROP TRIGGER IF EXISTS trg_log_role_change ON public.user_roles;
CREATE TRIGGER trg_log_role_change
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS trg_log_dept_change ON public.profiles;
CREATE TRIGGER trg_log_dept_change
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_department_change();
