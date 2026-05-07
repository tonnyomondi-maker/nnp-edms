## Plan

### 1. Fix IQA Archive crash (blank/not responding)
`src/pages/iqa/ArchiveScreen.tsx` calls `useState`/`useEffect`/`useMemo` *after* an early `return` (loading guard). This breaks the Rules of Hooks and crashes the page on every render where loading flips. Move all hooks above the `if (isLoading)` return.

### 2. Expand Modular course to Module 1–10
- `src/lib/sessions.ts`: change `MODULE_NUMBERS` to `1..10`.
- DB: update `validate_course_stage()` trigger function to accept `module_number` 1–10 (currently capped at 8). Migration only — no data changes.
- Audit all selectors (`UploadDocuments.tsx`, `useUnitSessionConfig.ts`, `TermFilter.tsx`) so Module 9/10 render and filter correctly.

### 3. Signature & stamp placement — formatting + auto-fill controls
In `PlacementModal`:
- Add per-image controls: width slider, opacity, rotation (0/90/180/270), and an aspect-lock toggle.
- Add a toggle group: "Auto-fill details" vs "Leave blanks for manual fill".
  - Auto-fill (default): system stamps name, position/role, signature image, date, and stamp image.
  - Blanks: only the stamp outline + labelled lines ("Name: ____", "Signature: ____", "Date: ____") are drawn so the approver can hand-write.
- Persist new fields on the `documents` row: `*_sig_w`, `*_sig_h`, `*_sig_rot`, `*_sig_opacity`, `*_stamp_w/h/rot/opacity`, plus `*_autofill boolean`.
- `stamp-document` edge function: respect width/height/rotation/opacity and the autofill flag. When `autofill=false`, draw only labelled blank lines and the empty stamp ring.

Migration adds the new nullable columns to `documents`.

### 4. HOD enhancements
- New tab in `DepartmentQueue.tsx`: **"Approved by me"** — lists docs where `hod_approved_by = auth.uid()` (statuses HOD_APPROVED, DP_APPROVED, ARCHIVED, plus REJECTED-by-me). Reuses the existing filter bar.
- Confirm department scoping: existing RLS already restricts HODs to their department — verified in policies. No change needed beyond ensuring the test HOD profile has `department` set (will surface in the new HOD dashboard if missing).
- New **HOD Dashboard** (`src/pages/hod/Dashboard.tsx`) showing:
  - Trainers in their department and submission counts (submitted / approved / rejected / missing).
  - Per-trainer missing one-time docs vs expected.
  - Quick link to their own "Upload" flow (HODs can still submit their own teaching docs).

### 5. Remove Assignments from DP Academics
- Remove the "Manage Assignments" nav entry and route gating for DP Academics in `src/components/layout/BottomNav.tsx` / `AppShell.tsx` and `App.tsx` routing. Trainers self-assign via Upload (already implemented), so DP no longer needs assignment management.
- Keep the page reachable only by Super Admin (see §6).

### 6. Super Admin role
- New enum value `SUPER_ADMIN` on `app_role` (migration: `ALTER TYPE app_role ADD VALUE 'SUPER_ADMIN'`).
- New page `src/pages/admin/SystemSetup.tsx` for: assigning/removing roles, setting departments on profiles, managing assignments (moved from DP), viewing all users.
- Update RLS on `user_roles` to allow `SUPER_ADMIN` (in addition to `DP_ACADEMICS`) to insert/update/delete roles. Long-term, DP role-management policies can be removed; for now keep both to avoid lockout.
- Seed: provide a SQL snippet the user runs (or we expose a one-time button) to grant SUPER_ADMIN to a chosen user. We'll prompt for the email after the plan is approved.
- Nav: SUPER_ADMIN sees "System Setup" entry; DP no longer sees "Manage Assignments".

### 7. Reports — real data, real metrics
Rewrite `src/pages/Reports.tsx` (and add role-scoped variants):
- Pull live from `documents`, `teaching_assignments`, `unit_session_config`, `profiles`.
- Tabs:
  1. **Per Trainer** — submissions count by status, % completeness against expected one-time docs (Learning Plan, Personal Timetable, Workload Allocation, Scheme of Work, Course Outline) per assigned unit.
  2. **Missing Documentation** — for each (trainer × unit), list missing one-time docs and missing weekly docs (Session Plan / Class Attendance) for the active session/term/module based on `unit_session_config`.
  3. **Department Compliance** — % per real department (the 8 listed earlier), drill-down by trainer.
  4. **Approval Throughput** — counts/avg time SUBMITTED→HOD→DP→ARCHIVED using `submitted_at`, `hod_approved_at`, `dp_approved_at`, `archived_at`.
- Scoping: HOD sees only their department; Trainer sees only themselves; DP/IQA/SUPER_ADMIN see all.
- Replace hard-coded `DEPARTMENTS` and `ONE_TIME_DOCS` arrays with imports from `src/lib/sessions.ts` (already includes Course Outline and the 8 departments).

### Database migrations summary
1. `validate_course_stage`: allow module_number 1–10.
2. `documents`: add `hod_sig_w/h/rot/opacity`, `hod_stamp_w/h/rot/opacity`, same for `dp_*` and `iqa_*`, plus `hod_autofill/dp_autofill/iqa_autofill boolean default true`.
3. `app_role`: add `SUPER_ADMIN`.
4. `user_roles` RLS: add SUPER_ADMIN policies for INSERT/UPDATE/DELETE/SELECT-all.

### Files to create
- `src/pages/hod/Dashboard.tsx`
- `src/pages/admin/SystemSetup.tsx`
- `src/components/common/ImageAdjustControls.tsx` (size/rotation/opacity sliders shared between sig & stamp)

### Files to modify
- `src/lib/sessions.ts`, `src/pages/iqa/ArchiveScreen.tsx`, `src/components/common/PlacementModal.tsx`, `supabase/functions/stamp-document/index.ts`, `src/hooks/useDocuments.ts` (persist new placement fields), `src/pages/hod/DepartmentQueue.tsx`, `src/pages/Reports.tsx`, `src/components/layout/BottomNav.tsx`, `src/components/layout/AppShell.tsx`, `src/App.tsx`, `src/contexts/AuthContext.tsx` (recognise SUPER_ADMIN).

### Open question before I implement
Which user email should receive the initial **SUPER_ADMIN** role? I'll seed it via an insert once you confirm.