
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_stamp_mode text NOT NULL DEFAULT 'IMAGE'
    CHECK (preferred_stamp_mode IN ('IMAGE','TEXT_ONLY')),
  ADD COLUMN IF NOT EXISTS stamp_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_sig_w numeric,
  ADD COLUMN IF NOT EXISTS default_sig_h numeric,
  ADD COLUMN IF NOT EXISTS default_sig_rot numeric,
  ADD COLUMN IF NOT EXISTS default_sig_opacity numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_w numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_h numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_rot numeric,
  ADD COLUMN IF NOT EXISTS default_stamp_opacity numeric;
