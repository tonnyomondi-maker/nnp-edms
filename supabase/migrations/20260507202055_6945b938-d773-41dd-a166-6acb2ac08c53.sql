DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'SUPER_ADMIN'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'SUPER_ADMIN';
  END IF;
END$$;