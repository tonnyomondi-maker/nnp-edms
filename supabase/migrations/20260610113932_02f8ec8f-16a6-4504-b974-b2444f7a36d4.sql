-- 1. system_settings singleton table for the Super Admin safety lock
CREATE TABLE IF NOT EXISTS public.system_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lock_active BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason TEXT,
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  locked_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can READ the lock state (needed to enforce guards client-side)
DROP POLICY IF EXISTS "Authenticated can read lock" ON public.system_settings;
CREATE POLICY "Authenticated can read lock"
  ON public.system_settings FOR SELECT
  TO authenticated USING (TRUE);

-- Only Super Admin may write (edge functions use service role, bypassing RLS)
DROP POLICY IF EXISTS "Super Admin can update lock" ON public.system_settings;
CREATE POLICY "Super Admin can update lock"
  ON public.system_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

DROP POLICY IF EXISTS "Super Admin can insert lock" ON public.system_settings;
CREATE POLICY "Super Admin can insert lock"
  ON public.system_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Seed the singleton row
INSERT INTO public.system_settings (id, lock_active) VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_system_settings_updated ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
