
## Scope

Recheck the full Trainer → HOD → DP Academics → IQA flow and fix the concrete issues you hit. Keep the current rule that any staff member can upload when they switch to their Trainer role (server already blocks self-approval).

## Root cause of the approval error

The `stamp-document` edge function fetches signature/stamp images with a plain `fetch()` guarded by an SSRF check. That worked when the `signatures` bucket was public, but it was made private during an earlier security pass. Private-bucket URLs return 400 on anonymous `fetch`, which surfaces to the client as "Edge function returned a non-2xx status code" during HOD/DP **Sign & Approve**. The same call succeeds for text-only Quick Verify because that path never fetches the images.

## What will change

### 1. Approval flow (fixes the non-2xx error)
- `supabase/functions/stamp-document/index.ts`: replace `fetchAsArrayBuffer(signatureUrl)` / `fetchAsArrayBuffer(stampUrl)` with the existing service-role `downloadFromStorage(parseStorageRef(url))`. Keep the SSRF guard (still reject any URL that isn't in this project's Storage).
- Return clearer error bodies (already JSON) and surface them on the client:
  - In `useDocuments.performApproval`, when `supabase.functions.invoke('stamp-document', …)` fails, read `stampResp?.error` (or `stampErr.context?.body`) and throw that string instead of the generic `stampErr.message`, so approvers see the real reason (e.g. "Policy requires an embedded stamp…").

### 2. Submit button feedback (Trainer upload)
- `src/pages/trainer/UploadDocuments.tsx`: compute a list of blocking reasons (`!canUpload`, `writesBlocked`, missing header field, invalid file row, in-flight upload) and render them under the Submit button whenever `canSubmit` is false. Keep the button disabled but always show the user what to fix.

### 3. Rejection with comments (HOD + DP + IQA)
- New `src/components/common/RejectDialog.tsx`: textarea (min 5 chars), optional category chips (Missing signature, CBET compliance, Wrong format, Other), and a "Return to previous stage" hint for DP/IQA that reuses the existing `ReturnStageDialog` behavior.
- Wire it into `DepartmentQueue.tsx`, `ApprovalQueue.tsx`, and `ArchiveScreen.tsx`, replacing the hardcoded `rejection_reason: 'Needs revision'` / `'Does not meet standards'`. Bulk reject already accepts a reason via `BulkActionBar`; extend the single-row Reject to the same dialog.

### 4. Resubmit after rejection (Trainer)
- `useDocuments.ts`: add `useRejectedDocuments()` hook (my documents with `status='REJECTED'`).
- `src/components/common/RejectedResubmitCard.tsx` shown on the trainer's My Documents page for each rejected doc, with a **Resubmit** button that navigates to `/trainer/upload?resubmit=<docId>`.
- `UploadDocuments.tsx`: on mount, if `?resubmit=` is present, read the source doc and prefill header (dept, unit code, unit name, class code, session, course type, term/module) + one pre-configured FileEntry with the correct `documentType` / `weekNumber` / `sessionIndex` and a "needs re-attach" prompt for the PDF. Successful submit creates a new SUBMITTED row (old REJECTED row remains for audit).
- The existing duplicate check already excludes REJECTED rows, so no schema change is needed.

### 5. Workflow sanity checks (no code changes required, verified during implementation)
- HOD queue already excludes docs where `trainer_id === currentUser.id`; `guard_document_update` trigger blocks self-approval server-side. Confirmed OK.
- DP → IQA → Archive transitions match `expectedStatus` map in `stamp-document`. Confirmed OK.
- Approver "Return to previous stage" already exists for DP and IQA via `ReturnStageDialog`.

## Files touched

```text
supabase/functions/stamp-document/index.ts      (private-bucket fix)
src/hooks/useDocuments.ts                        (surface stamp error; add useRejectedDocuments)
src/pages/trainer/UploadDocuments.tsx            (submit reasons + ?resubmit= prefill)
src/pages/hod/DepartmentQueue.tsx                (RejectDialog)
src/pages/dp/ApprovalQueue.tsx                   (RejectDialog)
src/pages/iqa/ArchiveScreen.tsx                  (RejectDialog)
src/components/common/RejectDialog.tsx           (new)
src/components/common/RejectedResubmitCard.tsx   (new)
src/pages/trainer/MyDocuments.tsx                (surface RejectedResubmitCard)
```

No database migration is needed.

## Verification

- Approve one HOD doc via **Sign & Approve** end-to-end and confirm the stamped PDF renders (real signature image, not a fetch error).
- Reject a doc, enter a comment, verify the trainer sees the comment on the rejected card, click **Resubmit**, confirm the upload page is prefilled and a new SUBMITTED row is created while the REJECTED one stays.
- Click Submit with an incomplete form and confirm the reason list appears under the button.
