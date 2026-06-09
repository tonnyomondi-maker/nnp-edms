-- Storage policies: backups bucket — Super Admin only
CREATE POLICY "Super admins read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins write backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins update backups"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY "Super admins delete backups"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'SUPER_ADMIN'));

-- Google Drive mirror fields on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS gdrive_file_id text,
  ADD COLUMN IF NOT EXISTS gdrive_web_view_link text;

-- Backup metadata table
CREATE TABLE public.backup_metadata (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  documents_count integer DEFAULT 0,
  audit_logs_count integer DEFAULT 0,
  storage_files_count integer DEFAULT 0,
  total_bytes bigint DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_metadata TO authenticated;
GRANT ALL ON public.backup_metadata TO service_role;

ALTER TABLE public.backup_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage backup metadata"
ON public.backup_metadata FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));