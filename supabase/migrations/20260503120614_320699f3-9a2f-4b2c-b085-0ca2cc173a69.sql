
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN ('trainer@test.com','hod@test.com','dp@test.com','iqa@test.com');

UPDATE public.profiles SET department = 'Computer Science', pf_number = 'PF-TRAINER' WHERE email = 'trainer@test.com';
UPDATE public.profiles SET department = 'Computer Science', pf_number = 'PF-HOD' WHERE email = 'hod@test.com';
UPDATE public.profiles SET department = 'Academics', pf_number = 'PF-DP' WHERE email = 'dp@test.com';
UPDATE public.profiles SET department = 'Quality Assurance', pf_number = 'PF-IQA' WHERE email = 'iqa@test.com';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'TRAINER'::app_role FROM auth.users WHERE email = 'trainer@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'HOD'::app_role FROM auth.users WHERE email = 'hod@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'DP_ACADEMICS'::app_role FROM auth.users WHERE email = 'dp@test.com'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'IQA'::app_role FROM auth.users WHERE email = 'iqa@test.com'
ON CONFLICT DO NOTHING;
