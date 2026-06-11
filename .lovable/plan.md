## 1. Persist UploadDocuments resume state

Today the per-file upload list lives in component state and disappears on refresh. I'll persist a metadata-only snapshot to `localStorage` and rehydrate on mount so the retry flow survives reloads.

**What gets persisted (per file, keyed by user id):**

- `id`, `fileName`, `originalSize`, `estimatedSize`, `compressed`, `eligibility`
- `documentType`, `weekNumber`, `sessionIndex`
- `stage`, `documentId`, `stageMessage`, `gdriveAttempts`
- Header fields (`sessionYear`, `sessionTerm`, `department`, `unitCode`, `unitName`, `classCode`, `courseType`, `termNumber`, `moduleNumber`, `sessionsPerWeek`)

**What it does not persist:** the raw `File` blob (browsers cannot serialize it safely). Strategy:

- Files that already reached `storage_ok` / `gdrive_ok` / `gdrive_failed` have a `documentId`. After refresh they're fully usable — the **Retry Drive upload** button works because it only needs `documentId`.
- Files still in `idle` / `compressing` / `uploading_storage` are rehydrated as a placeholder card marked **Needs re-attach** with the original filename and metadata. The trainer can either reattach the same file (matched by name) to continue, or remove it.
- A new **Clear resume state** action wipes the snapshot.

Snapshot is written on every state change (debounced) and cleared once all entries reach a terminal state (`gdrive_ok` or removed).

## 2. Role-aware action buttons with tooltips

Wrap every action button across the app in a shared `<ActionGuardButton>` that uses `useRoleGuard` to disable the button when `canActOn(action, doc)` is false and renders a `<Tooltip>` showing `guard.reasonFor(action, doc)` (e.g. "Switch to your HOD role to verify this document.", "System safety lock is active — writes are blocked.", "Only Super Admin can delete documents.").

Buttons updated:

- `UploadDocuments`: Submit, Retry Drive upload
- `hod/DepartmentQueue`, `dp/ApprovalQueue`, `iqa/ArchiveScreen`: Approve, Reject, Bulk actions
- `MySubmissions`, `Reports`, `SessionExports`: Export
- `admin/ManageUsers`, `admin/SystemBackups`: Delete / Reset
- `DocumentCard` action menu: View (always) vs Approve/Reject/Delete (guarded)

A single component keeps copy consistent and screen-reader friendly (`aria-disabled` + tooltip describing the reason).

## 3. Flexible signature & approval flow

**Current behavior (verified):** `performApproval` in `useDocuments.ts` requires both `signature_url` and `stamp_url` when `mode='IMAGE'`. There is already a `TEXT_ONLY` mode but the UI only exposes it implicitly during bulk approvals.

**Changes:**

*ProfileSettings*

- Add a **Signature method** selector with three options that the approver can switch between any time:
  1. **Upload image** — current PNG upload (unchanged).
  2. **Draw signature** — a small `<canvas>` pad; saved as transparent PNG to the `signatures` bucket using the same path scheme.
  3. **Typed signature** — pick a handwriting font + name; rendered to PNG on save.
- Add a stamp **optional** toggle: many institutions only require a signature. When stamp is missing the approval pipeline falls back to signature-only embedding.
- Show **Approval readiness** status: "Ready (image)", "Ready (text-only)", or "Needs setup" with a one-click switch.

*Approval action UI (`PlacementModal` and queues)*

- Replace the implicit mode with an explicit toggle group: **Image stamp** / **Text-only stamp**. Default = whichever the approver last used (persisted in profile column `preferred_stamp_mode`).
- In Image mode allow per-approval tweaks: size, rotation, opacity sliders for both signature and stamp; "Save as my default" stores them on the profile so next approval reuses them.
- Allow approval to proceed with **only a signature** (no stamp) when the approver chose that path — back-end check is relaxed accordingly.

*Backend*

- `performApproval`: only require `signature_url` (not `stamp_url`) in IMAGE mode; pass `stampUrl: ''` to `stamp-document` when absent.
- Migration: add `profiles.preferred_stamp_mode` (`IMAGE`|`TEXT_ONLY`, default `IMAGE`), `profiles.stamp_required` (bool, default true), and default placement columns (`default_sig_w`, `default_sig_h`, `default_sig_opacity`, etc.) for "Save as my default".
- `stamp-document` edge function already tolerates an empty `stampUrl` for text-only; verify and update the branch that skips stamp embedding when the URL is empty in image mode too.

## 4. Are files now stored in Google Drive?

**Yes — mirrored, not replaced.** Today's flow (in `useDocuments.useSubmitDocument` + `supabase/functions/gdrive-upload`):

1. Trainer submit → file uploaded to Lovable Cloud Storage `documents` bucket (with 3-attempt retry).
2. Row inserted into `documents` table.
3. `gdrive-upload` edge function is invoked best-effort. It downloads from Storage, then POSTs a multipart upload through the Lovable connector gateway to **Tonny's connected Google Drive account** with up to 4 retries + exponential backoff.
4. On success the row is updated with `gdrive_file_id` and `gdrive_web_view_link`, and an `audit_logs` row with `action='GDRIVE_MIRRORED'` is written.

**Important caveats to surface in the UI:**

- The connector uses the `drive.file` scope, so files land in the **root of the connected Drive** (not in nested folders); the intended `EDMS/{year}_{term}/{dept}/{unit}` path is stored in the file description for searchability. If you want real folders, we'd need to switch to a per-user OAuth flow with the broader `drive` scope.
- The Drive copy is a **backup mirror**. The app still serves PDFs from Lovable Storage; nothing currently reads the file back from Drive.
- Drive uploads are best-effort: storage upload is the source of truth, the Drive mirror retry button (already in UploadDocuments) and the new persisted resume state let the trainer recover failed mirrors after refresh.

## Technical changes

**Frontend**

- `src/hooks/useUploadResume.ts` — new: localStorage snapshot read/write, debounced.
- `src/pages/trainer/UploadDocuments.tsx` — hydrate from snapshot, render "Needs re-attach" placeholders, wire Clear button.
- `src/components/common/ActionGuardButton.tsx` — new wrapper around `Button` + `Tooltip` + `useRoleGuard`.
- Replace direct `<Button>` action calls across queues, archive, reports, exports, manage-users, system-backups, document card.
- `src/pages/ProfileSettings.tsx` — signature method tabs (upload/draw/type), stamp-optional toggle, readiness badge, defaults persistence.
- `src/components/common/PlacementModal.tsx` — explicit Image vs Text-only toggle, "Save as default" action.
- `src/hooks/useDocuments.ts` — relax stamp requirement; thread chosen mode + saved defaults.

**Backend**

- Migration: add `preferred_stamp_mode`, `stamp_required`, `default_sig_*`, `default_stamp_*` columns on `profiles`.
- `supabase/functions/stamp-document/index.ts` — skip stamp embedding when `stampUrl` is empty (image mode); keep text-only path intact.

No schema changes touch `documents`, `audit_logs`, or storage policies. Google Drive integration is unchanged in this pass — we only document its current behavior and offer the folder-scope upgrade as a follow-up.  Proceed.

&nbsp;