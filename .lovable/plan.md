## Goal
Give users a reliable way to re-mirror any document to Google Drive after an initial failure, from anywhere the document appears — not only during the original upload session. Also confirm and clarify the current approval-signing flow.

## 1. Persist Drive sync state per document

Add tracking columns to `documents` so we know exactly which files failed vs. succeeded and can surface a retry action long after upload:

- `gdrive_sync_status` — enum-like text: `pending | success | failed | skipped`
- `gdrive_last_error` — text (last failure message)
- `gdrive_last_attempt_at` — timestamptz
- `gdrive_attempt_count` — int

`gdrive-upload` edge function updates these fields on every attempt (success clears error and sets `success`; failure records the error and `failed`). Existing rows with `gdrive_file_id` set are backfilled to `success`; the rest to `pending`.

## 2. Reusable `RetryDriveSyncButton` component

New component `src/components/common/RetryDriveSyncButton.tsx`:

- Props: `documentId`, `syncStatus`, `webViewLink`, `lastError`, optional `size`.
- Behavior:
  - If `success` → shows "Open in Drive" link (uses `gdrive_web_view_link`).
  - If `failed` or `pending` (with a stored file) → shows "Retry Drive sync" button; on click, invokes `gdrive-upload` and toasts success/failure with the specific error message.
  - Disabled state while in-flight with spinner.
  - Uses `sonner` toasts and refreshes the parent list via a passed `onSynced` callback (or React Query invalidation where applicable).
- Wrapped in `ActionGuardButton` so it respects role permissions (owner + HOD/DP/IQA/SUPER_ADMIN, matching the edge function's authorization).

## 3. Surface the button in the document lists

Wire the button into the places a document row is shown so users can retry without going back to the upload screen:

- `src/pages/trainer/UploadDocuments.tsx` — in-session tile keeps its existing inline retry, plus the shared button on the "My submissions" list for prior uploads.
- `src/pages/hod/DepartmentQueue.tsx`, `src/pages/dp/ApprovalQueue.tsx`, `src/pages/iqa/ArchiveScreen.tsx` — one small Drive status chip + retry/open button per row.
- No changes to approval logic; the button is purely a mirror action.

## 4. Feedback + audit

- Success toast: "Mirrored to Google Drive" with an "Open" action linking to `webViewLink`.
- Failure toast: "Google Drive sync failed — {error}" and the error also persists in `gdrive_last_error` for later inspection.
- Every attempt already writes an `audit_logs` row via the edge function; failures now log too (`GDRIVE_MIRROR_FAILED` with error + attempt count).

## 5. Approval-signing flow — clarification (no code change unless you want one)

Current behavior (already implemented in earlier turns):

- Approvers can approve using **either** an uploaded signature **or** an uploaded stamp **or** both, subject to the per-document-type policy in `document_type_policy` (`signature_only_allowed`, `stamp_required`).
- The `stamp-document` edge function stamps the PDF with whichever assets the approver has and always appends the approver's role, name, and date at the bottom of the page.
- If a document type has `signature_only_allowed = false` AND `stamp_required = true`, approval is blocked unless a stamp asset exists.
- If neither asset exists but policy permits, we still write a **text-only approval block** (role + name + date) at the end of the document — so approvals never silently succeed without a visible marker.

If you want the text-only fallback to be togglable per policy (e.g. "always require at least a signature") tell me and I'll add a `text_only_allowed` flag; otherwise this section is informational only.

## Technical details

- Migration: `alter table public.documents add column ... ; update ... set gdrive_sync_status = 'success' where gdrive_file_id is not null;` (no new table, existing GRANTs/RLS cover it).
- `types.ts` regenerates after migration.
- Edge function edits are additive (status writes + error capture); the existing SSRF and role guards stay in place.
- Client uses `supabase.functions.invoke('gdrive-upload', { body: { documentId } })`; no new endpoints.
