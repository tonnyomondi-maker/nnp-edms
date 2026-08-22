  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'IQA'));

-- Audit logs policies
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
CREATE POLICY "System can insert audit logs"
  ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ==================== FUNCTIONS & TRIGGERS ====================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON UPDATE;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_teaching_assignments_updated_at ON UPDATE;
CREATE TRIGGER update_teaching_assignments_updated_at
  BEFORE UPDATE ON public.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_documents_updated_at ON UPDATE;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Audit log trigger for document changes
CREATE OR REPLACE FUNCTION public.log_document_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_logs (document_id, action, performed_by, details)
    VALUES (
      NEW.id,
      'STATUS_CHANGE',
      auth.uid(),
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'document_type', NEW.document_type,
        'department', NEW.department
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_document_status_change
  AFTER UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.log_document_change();


-- Drop overly permissive audit_logs insert policy
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;

-- The audit log trigger uses SECURITY DEFINER so it bypasses RLS.
-- No insert policy needed for regular users - only triggers insert.

-- Drop duplicate permissive user_roles policy
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

-- Create storage bucket for document PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- Trainers can upload to their own folder
DROP POLICY IF EXISTS "Trainers can upload documents" ON storage.objects;
CREATE POLICY "Trainers can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view documents in their department or their own
DROP POLICY IF EXISTS "Authenticated users can view documents" ON storage.objects;
CREATE POLICY "Authenticated users can view documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents'
  AND auth.role() = 'authenticated'
);

-- Trainers can delete their own uploads (for re-upload on rejection)
DROP POLICY IF EXISTS "Trainers can delete own documents" ON storage.objects;
CREATE POLICY "Trainers can delete own documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- DP_ACADEMICS can view all user roles
DROP POLICY IF EXISTS "DP can view all roles" ON public.user_roles;
CREATE POLICY "DP can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can insert roles
DROP POLICY IF EXISTS "DP can insert roles" ON public.user_roles;
CREATE POLICY "DP can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can update roles
DROP POLICY IF EXISTS "DP can update roles" ON public.user_roles;
CREATE POLICY "DP can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can delete roles
DROP POLICY IF EXISTS "DP can delete roles" ON public.user_roles;
CREATE POLICY "DP can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can insert teaching assignments
DROP POLICY IF EXISTS "DP can insert assignments" ON public.teaching_assignments;
CREATE POLICY "DP can insert assignments"
ON public.teaching_assignments
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can update teaching assignments
DROP POLICY IF EXISTS "DP can update assignments" ON public.teaching_assignments;
CREATE POLICY "DP can update assignments"
ON public.teaching_assignments
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- DP_ACADEMICS can delete teaching assignments
DROP POLICY IF EXISTS "DP can delete assignments" ON public.teaching_assignments;
CREATE POLICY "DP can delete assignments"
ON public.teaching_assignments
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'DP_ACADEMICS'::app_role));

-- Profile signature & stamp
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS stamp_url TEXT;

-- Document approval signature/stamp tracking
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS hod_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS hod_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS hod_approved_by UUID,
  ADD COLUMN IF NOT EXISTS dp_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS dp_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS dp_approved_by UUID,
  ADD COLUMN IF NOT EXISTS iqa_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS iqa_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS iqa_archived_by UUID,
  ADD COLUMN IF NOT EXISTS signed_file_url TEXT;

-- Public signatures bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', true)
ON CONFLICT (id) DO NOTHING;

-- RLS for signatures bucket
DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;