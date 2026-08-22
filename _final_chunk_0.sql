
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