ALTER TABLE public.verification_packs
  ADD COLUMN IF NOT EXISTS include_dp_approved boolean NOT NULL DEFAULT false;