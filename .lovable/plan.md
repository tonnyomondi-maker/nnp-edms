

# Plan: Admin Panel + Google OAuth

## Overview
Add an admin management panel (for DP_ACADEMICS role acting as admin) to manage users/roles and teaching assignments, plus Google OAuth sign-in.

## 1. Database Changes (Migration)

- Add RLS policies on `teaching_assignments` allowing DP_ACADEMICS to INSERT, UPDATE, DELETE
- Add RLS policies on `user_roles` allowing DP_ACADEMICS to INSERT, UPDATE, DELETE
- Add RLS policy on `user_roles` allowing DP_ACADEMICS to SELECT all roles (currently users can only see their own)
- Add RLS policy on `profiles` allowing DP_ACADEMICS to view all profiles (already allowed for all authenticated, so this is fine)

## 2. Admin Pages

**`src/pages/admin/ManageUsers.tsx`** — User & Role Management
- List all profiles with their current roles
- Add/remove roles for any user (dropdown with TRAINER, HOD, DP_ACADEMICS, IQA)
- Search/filter users by name or department

**`src/pages/admin/ManageAssignments.tsx`** — Teaching Assignment Management
- List all teaching assignments with trainer name, unit, class, department
- Form to create new assignments: select trainer (from profiles), enter unit_code, unit_name, class_code, department, term, academic_year
- Edit and delete existing assignments

## 3. Navigation Updates

- Add `ADMIN` equivalent using DP_ACADEMICS role — when active role is DP_ACADEMICS, show an "Admin" tab in BottomNav linking to `/admin/users`
- Add routes: `/admin/users` and `/admin/assignments`
- Admin pages get a tab bar at top to switch between Users and Assignments

## 4. Google OAuth

- Use the Configure Social Auth tool to set up Google OAuth with Lovable Cloud's managed credentials
- Update `Auth.tsx` to add a "Sign in with Google" button using `lovable.auth.signInWithOAuth("google", ...)`
- Handle the OAuth callback and redirect flow

## 5. Auth Context Update

- Update `AuthContext.tsx` to add a helper `isAdmin` computed from `has_role` check for DP_ACADEMICS
- Protect admin routes so only DP_ACADEMICS users can access them

## Technical Notes

- DP_ACADEMICS acts as the system admin (no new role enum needed)
- The `handle_new_user` trigger already creates profiles on signup, so Google OAuth users get profiles automatically
- Google OAuth uses Lovable Cloud's managed credentials — no setup needed from the user

## Files to Create/Modify
- **Create**: `src/pages/admin/ManageUsers.tsx`, `src/pages/admin/ManageAssignments.tsx`
- **Modify**: `src/App.tsx` (add routes), `src/components/layout/BottomNav.tsx` (add admin nav), `src/pages/Auth.tsx` (Google button), `src/contexts/AuthContext.tsx` (isAdmin helper)
- **Migration**: RLS policies for admin operations on `user_roles` and `teaching_assignments`

