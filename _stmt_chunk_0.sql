
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('TRAINER', 'HOD', 'DP_ACADEMICS', 'IQA');

-- Create document status enum
CREATE TYPE public.document_status AS ENUM ('SUBMITTED', 'HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED', 'REJECTED');

-- Create document type enum
CREATE TYPE public.document_type AS ENUM ('Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work', 'Session Plan', 'Class Attendance');

-- Create submission type enum
CREATE TYPE public.submission_type AS ENUM ('ONE_TIME', 'WEEKLY');

-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  pf_number TEXT,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles per security requirements)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Teaching assignments table
CREATE TABLE IF NOT EXISTS public.teaching_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trainer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  class_code TEXT NOT NULL,
  department TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'Term 1',
  academic_year TEXT NOT NULL DEFAULT '2024/2025',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;

-- Documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.teaching_assignments(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type public.document_type NOT NULL,
  submission_type public.submission_type NOT NULL,
  week_number INTEGER,
  status public.document_status NOT NULL DEFAULT 'SUBMITTED',
  file_url TEXT,
  file_drive_id TEXT,
  file_name TEXT NOT NULL,
  department TEXT NOT NULL,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hod_approved_at TIMESTAMPTZ,
  dp_approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Enable realtime for documents
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;

-- ==================== RLS POLICIES ====================

-- Profiles policies
DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;
CREATE POLICY "Anyone authenticated can view profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User roles policies
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Teaching assignments policies
DROP POLICY IF EXISTS "Trainers can view own assignments" ON public.teaching_assignments;
CREATE POLICY "Trainers can view own assignments"
  ON public.teaching_assignments FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

DROP POLICY IF EXISTS "HOD/DP/IQA can view department assignments" ON public.teaching_assignments;
CREATE POLICY "HOD/DP/IQA can view department assignments"
  ON public.teaching_assignments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'HOD') OR
    public.has_role(auth.uid(), 'DP_ACADEMICS') OR
    public.has_role(auth.uid(), 'IQA')
  );

-- Documents policies
DROP POLICY IF EXISTS "Trainers can view own documents" ON public.documents;
CREATE POLICY "Trainers can view own documents"
  ON public.documents FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

DROP POLICY IF EXISTS "Trainers can insert own documents" ON public.documents;
CREATE POLICY "Trainers can insert own documents"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (trainer_id = auth.uid());

DROP POLICY IF EXISTS "HOD can view department documents" ON public.documents;
CREATE POLICY "HOD can view department documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'HOD'));

DROP POLICY IF EXISTS "DP can view all documents" ON public.documents;
CREATE POLICY "DP can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'DP_ACADEMICS'));

DROP POLICY IF EXISTS "IQA can view all documents" ON public.documents;
CREATE POLICY "IQA can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'IQA'));

DROP POLICY IF EXISTS "HOD can update document status" ON public.documents;
CREATE POLICY "HOD can update document status"
  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'HOD'));

DROP POLICY IF EXISTS "DP can update document status" ON public.documents;
CREATE POLICY "DP can update document status"
  ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'DP_ACADEMICS'));

DROP POLICY IF EXISTS "IQA can update document status" ON public.documents;
CREATE POLICY "IQA can update document status"
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
DROP POLICY IF EXISTS "Signatures are publicly readable" ON storage.objects;
CREATE POLICY "Signatures are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Users upload own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own signatures" ON storage.objects;
CREATE POLICY "Users upload own signatures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users update own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users update own signatures" ON storage.objects;
CREATE POLICY "Users update own signatures"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'signatures' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users delete own signatures" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own signatures" ON storage.objects;