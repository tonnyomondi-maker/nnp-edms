# Workload allocation, upload simplification, and PDF branding

## 1. Workload allocation — one per training session (priority)

Rules to enforce:
- One Workload Allocation per trainer per training session, covering every assigned unit (no unit/class code needed).
- A second upload is blocked while an existing one is submitted, verified, reviewed, approved or archived. A new upload is only allowed if the existing one was rejected — and then only through "Edit & resubmit", keeping version history.
- Enforcement in three places: the upload form (clear, plain-English reason), the submit mutation (re-check just before insert to close the double-tap race), and a database rule so duplicates can never land.

Making it visible to approvers (the reason it matters — approvers use it to check that all allocated units were registered):
- In HOD, IQAO, DP Academics and Super Admin queues, the trainer's Workload Allocation is pinned at the top of that trainer's group as a distinct "Workload allocation" card instead of falling into an "Unspecified unit" bucket.
- The card shows its approval status plus the list of units the trainer has registered this session, so the approver can compare the form against the registered units in one glance.
- Where a trainer has no workload allocation on file, the group shows a clear "No workload allocation submitted" warning row.

## 2. Remove upload resume state

Trainers have been confused by restored entries that cannot upload because the file handle is gone. Remove resume/re-attach entirely: no saved snapshot, no "Re-attach the file" rows, no "Clear resume state" button. The upload page always starts clean. Any previously saved snapshot is cleared on first load.

## 3. Default role on signup

The database already assigns the TRAINER role to every new account. This step verifies it end to end: signup creates the profile and TRAINER role, the role switcher in the top bar shows Trainer as the active role, and additional roles added later by an admin appear in the switcher without a re-login.

## 4. Reports — quick filters and drill-down

The Reports page already has session, department, trainer and document-type filters with drill-down. Work here is a mobile pass: filters collapse into a compact two-tap filter row, tap targets at 44px, active filters shown as removable chips, and drill-down (department -> trainer -> document type) reachable without horizontal scrolling.

## 5. Export progress and toasts

Already present for the report PDF. Extend the same pattern to the remaining Super Admin exports (session ZIP export, audit trail PDF, audit/security CSV): a visible step indicator while running, a success toast when the download is ready, and a specific error toast on failure.

## 6. Consistent PDF branding

Apply the same branded header everywhere a PDF is produced:
- Logo, "The Nyamira National Polytechnic" as the institution name, and the document/report subtitle on the cover.
- Repeated compact header on section breaks, with page numbering in the footer.
- Applies to: submission report PDF (update institution name), document audit-trail PDF, and the approval sheet appended to approved documents.

## Technical notes

- `src/lib/sessions.ts` already defines `SESSION_LEVEL_DOC_TYPES = ['Workload Allocation']`; reuse it rather than new constants.
- Upload validation lives in `validateFile` / `rejectedBlocks` in `src/pages/trainer/UploadDocuments.tsx`; extend the session-level branch and mirror the check inside the submit mutation in `src/hooks/useDocuments.ts`.
- Database: partial unique index on `documents(trainer_id, session_year, session_term)` where `document_type = 'Workload Allocation'` and `status <> 'REJECTED'`.
- Approver queues render through `src/components/common/HierarchyGroups.tsx`; add a pinned session-level slot at the TRAINER level rather than adding a new hierarchy level.
- Delete `src/hooks/useUploadResume.ts` and its usage; drop the `needsReattach` handling.
- PDF branding: shared header helper for `src/lib/reportPdf.ts` (jsPDF) and an equivalent for the pdf-lib code in `supabase/functions/generate-audit-trail` and `supabase/functions/stamp-document`, with the logo embedded as a base64 constant for the edge functions.
