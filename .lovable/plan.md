# Plan: Super Admin, Setup Hardening, Compression & Stamp Date Consistency

## 1. Designated Super Admin: tonny.omondi@nyamirapoly.ac.ke
- Update `bootstrap_super_admin` RPC to **only** allow promotion of `tonny.omondi@nyamirapoly.ac.ke` (case-insensitive). Any other email is rejected.
- On `SystemSetup` Step 1, pre-fill and lock the email field to that address; user only needs to type "CONFIRM" to enable.
- If the target account has not yet signed up, show a friendly message: "Ask Tonny Omondi to sign up first using tonny.omondi@nyamirapoly.ac.ke, then return here."
- Auto-bootstrap path: when that user signs in and no SUPER_ADMIN exists, AuthContext silently calls the RPC so role is granted on first login.

## 2. Signup: department dropdown + default TRAINER role
- Replace free-text "Department" input in `src/pages/Auth.tsx` with a `<Select>` populated from `DEPARTMENTS` in `src/lib/sessions.ts`. Required field.
- Extend `handle_new_user()` trigger to also write `department` and `pf_number` from `raw_user_meta_data`, and to INSERT a `TRAINER` row into `user_roles` for every new user (idempotent via `ON CONFLICT DO NOTHING`).
- Remove client-side trainer-role assumption; rely on DB trigger.

## 3. Super Admin user management
- Grant SUPER_ADMIN the same INSERT/UPDATE/DELETE rights on `user_roles` and `profiles` that DP_ACADEMICS has (policies already partly exist; add missing ones).
- In `ManageUsers.tsx`:
  - "Add user" dialog (Super Admin only): collects email, name, department, optional "Mark as test user" toggle. Calls a new `admin-create-user` edge function (uses service role to `auth.admin.createUser` with a temp password + email invite).
  - "Test user" tag stored in `profiles.is_test_user boolean` (new column); shown as badge; filterable.
  - Role chips already allow add/remove — confirm multi-role works (DP can also be TRAINER+HOD+IQA — backend already supports this).

## 4. System Reset (fresh start)
- Add Step 5 "Danger Zone" in `SystemSetup.tsx`, visible only to SUPER_ADMIN.
- Button "Reset all data" → modal requires typing `RESET <year>-<month>-<day>` to confirm.
- Calls new `system-reset` edge function (service role) that:
  - Deletes all rows from `documents`, `audit_logs`, `role_change_audit`, `unit_session_config`, `teaching_assignments`.
  - Empties `documents` and `signatures` storage buckets.
  - Preserves `profiles`, `user_roles`, and the SUPER_ADMIN.
  - Writes a final `audit_logs` entry `SYSTEM_RESET` with actor + timestamp **after** wipe.

## 5. IQA early-download DPA 2019 acknowledgement modal
- Before any IQA early download in `ArchiveScreen.tsx`, show a blocking dialog that:
  - Lists Kenya DPA 2019 obligations (lawful basis s.30, purpose limitation, confidentiality, retention).
  - Requires checking "I acknowledge my obligations under the Kenya Data Protection Act 2019" + typing the reason (existing min-10-char rule).
  - Acknowledgement (`dpa_acknowledged: true`) is stored in the audit_logs `details` jsonb.
- Acknowledgement is required every time (not cached), per compliance best practice.

## 6. Upload compression while preserving eligibility
- New util `src/lib/compressUpload.ts`:
  - **PDF**: load with `pdf-lib`, re-save with `useObjectStreams: true` and re-encode embedded images via canvas at 150 DPI / JPEG q=0.82. Skip if resulting file is larger than original.
  - **Images (jpg/png)**: resize so max dimension ≤ 2200px, re-encode as JPEG q=0.85.
  - **Other types** (docx, xlsx): pass through unchanged.
  - Hard cap: never produce a file smaller than 50KB unless original was; never alter PDF text content.
- Wire into `src/pages/trainer/UploadDocuments.tsx` before storage upload; show "Optimised 4.2 MB → 1.1 MB" toast.

## 7. Consistent stamp dates across exports (new DB fields)
- Migration:
  - `documents.verified_by_hod_at timestamptz` — set on HOD approve, immutable thereafter.
  - `documents.approved_by_dp_academics_at timestamptz` — set on DP approve, immutable thereafter.
  - Backfill from existing `hod_approved_at` / `dp_approved_at`.
  - Trigger blocks UPDATE if either column is already non-null (prevents re-dating on re-stamp/re-export).
- `useDocuments.ts`: when transitioning to `HOD_APPROVED` / `DP_APPROVED`, set the new field only if currently null.
- `stamp-document/index.ts`: TEXT_ONLY and IMAGE branches read these fields from the document row and render the **stored** date/time instead of `new Date()`. Same value is used in any future re-export, ensuring identical text across ZIPs and PDFs.

## 8. Fault tolerance pass
- Wrap every Supabase call in `SystemSetup`, `ManageUsers`, `ArchiveScreen`, and edge functions with try/catch + user-friendly toast (no silent failures).
- Add retries (3× exponential backoff) for `stamp-document`, `export-session-zip`, and the new `admin-create-user` / `system-reset` invocations.
- All edge functions: validate body with `zod`, return 400 with field errors; 500 paths always include `corsHeaders`.
- `AuthContext`: if profile load fails, retry once and fall back to a minimal user object rather than freezing the app.
- Storage download fallbacks: try signed URL → public URL → service-role download in order.

---

## Technical Notes
- New migrations: dept dropdown trigger update, super-admin email pin, `is_test_user`, reset audit action enum-free (already text), `verified_by_hod_at` + `approved_by_dp_academics_at` columns + immutability trigger.
- New edge functions: `admin-create-user`, `system-reset` (both `verify_jwt = false` with in-code JWT + SUPER_ADMIN check).
- No changes to existing approval flow semantics; only date source changes.
- Compression is client-side only (no server cost); skip-on-larger guard prevents regressions.

## Out of Scope
- Changing existing IQA archive signature/stamp placement flow.
- Re-architecting role model (multi-role already supported).
- Email template customisation for invited users (uses Supabase default).
