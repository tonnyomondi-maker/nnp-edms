# Fix approval failures and give approvers a real document preview

## What I found (verified)

- The five documents currently sitting in the queues (all `SUBMITTED`, uploaded 26–29 Aug) have **no file attached at all**: `file_url` is empty, `gdrive_file_id` is null, `gdrive_sync_status` is still `pending`, and the storage buckets contain only signatures and templates — zero document files.
- Because of that, approving any of them makes the stamping function throw ("Document has no parseable file reference"), which comes back to the browser as the generic **"Edge function returned a non-2xx status"** toast. The Google Drive connector itself is configured, and the stamping function is deployed and responding.
- The approver toolbar already has Verify / Audit / CSV / Timeline / View PDF, but the View PDF button **renders nothing when a document has no file** — so approvers see no way to open the file.

So there are two problems: file-less documents were allowed to exist, and the errors they cause are unreadable.

## Plan

### 1. Make upload failures impossible to miss
- After the Drive upload step in the upload flow, confirm the document row actually received a Drive file ID. If it did not, delete the ghost row and show the real reason to the trainer instead of a silent "submitted".
- Show the true server message on failure (the app already has a helper for this; the approval path is not using it).

### 2. Clear errors instead of "non-2xx"
- Stamping returns a proper JSON error with a plain message such as "This document has no attached file — the trainer must re-upload it before it can be verified", rather than crashing with a 500.
- The approve/verify/review actions surface that exact message in the toast.

### 3. Flag file-less documents in every queue
- Documents without an attached file get a visible "No file attached" warning badge, and approve/verify/review buttons are disabled for them with a tooltip explaining the trainer must re-upload.
- Super Admin gets a small maintenance action to remove these orphan records so trainers can re-submit cleanly (the five existing ones fall in this group).

### 4. Proper in-app document preview for approvers
- Replace the current "View PDF" link with a **View** action that opens a full-screen, mobile-friendly PDF viewer dialog (with page scrolling, download, and open-in-new-tab), sitting alongside Verify / Audit / CSV / Timeline on every document card.
- Works for Drive-stored and storage-stored files, shows a spinner while the file resolves, a retry on failure, and a clear "No file attached" state.
- Available in HOD Department Queue, IQAO Review Queue, DP Approval Queue, IQAO Archive, and Admin All Documents.

### 5. End-to-end re-check of the flow
- Upload as trainer → Drive receives the PDF and the row records the file ID → HOD verify → IQAO review → DP approve → IQAO archive, confirming the approval sheet stamping and Drive placement work at each stage.
- Run the Drive integration health check and smoke test afterwards and report the results.

## Technical notes

- `src/hooks/useDocuments.ts`: post-upload verification of `gdrive_file_id`, use `getEdgeFunctionErrorMessage` in the approval path.
- `supabase/functions/stamp-document/index.ts`: return 400/409 JSON for missing-file and missing-Drive-config cases instead of throwing.
- New `DocPreviewDialog` component; `DocPreviewLink`/`DocumentCard` updated to use it and to render a disabled "No file" state.
- Guarding uses the existing `ActionGuardButton` pattern, so role rules stay unchanged.
