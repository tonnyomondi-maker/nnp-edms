# Workflow terminology, approval sheet, resubmission and Drive-final-copy fixes

## 1. Remove "Scheme of Work"

- Drop it from the trainer upload lists, HOD/DP/IQAO filters, verifier pack composition, approval policies, SLA target pickers and template defaults.
- Keep the database enum value untouched (existing documents keep rendering) but hide it everywhere in the UI and exclude it from new submissions.

## 2. Rename IQA to IQAO and fix stage verbs

Correct chain wording everywhere (badges, timelines, notifications, approval sheet, guides, page titles, buttons):

```text
Trainer submits
  -> HOD VERIFIES        -> "Forwarded to IQAO for review"
  -> IQAO REVIEWS        -> "Forwarded to Deputy Principal - Academics for approval"
  -> D/P Academics APPROVES -> "Approved - returned to IQAO for archiving"
  -> IQAO ARCHIVES       -> "Archived"
```

- Role label `IQA` renders as `IQAO` in the UI (the `app_role` enum value stays `IQA` in the database).
- Approval sheet slot titles become: 1. Verified by Head of Department, 2. Reviewed by IQAO, 3. Approved by Deputy Principal - Academics.
- Toasts and in-app notifications use the exact forward messages above at each stage.

## 3. Signature placement + stamp layouts

Current behaviour: any custom placement completely overrides the layout-driven approval sheet, so the ordered sheet is skipped, and the placement dialog closes on sign leaving no confirmation of where marks landed.

Changes:
- The active stamp layout becomes the default: signing without opening placement always fills that stage's slot on the approval sheet.
- The placement dialog becomes an explicit, optional "place on document page instead" mode with a "Use approval sheet layout" toggle that is on by default.
- Keep the placement preview mounted while the sign request runs (spinner inside the dialog, close only on success) so the placement no longer disappears mid-action, and show a post-sign confirmation of which layout/slot was used.
- Bulk signing follows the same rule: layout slot by default, custom placement only when explicitly chosen.

## 4. Rejection, resubmission and re-upload lock

- Fix the resubmit route so `/trainer/upload?resubmit=<id>` reliably prefills unit, document type, week/session and links the new file to the same document record (status returns to `SUBMITTED`, keeping one continuous history).
- Block the normal upload path for any unit + document type + session that already has a `REJECTED` document: the picker shows a locked notice with an "Edit & resubmit" link instead.
- Trainer submissions "Rejected" section gets prominent cards: rejector name and role, stage, timestamp, and the full rejection/return note.
- Rejection and return notes surface in the notification list and on the document timeline at each stage, not just on the card.

## 5. Google Drive: approved copies only, trainer access

- Confirmed today: mirroring already runs only on DP approval and archival, and raw trainer uploads are never pushed. Keep that, and add a guard so any manual/retry mirror refuses documents that are not DP-approved or archived.
- After IQAO archiving, re-mirror the fully signed PDF so the Drive copy is the final approved version, and record the Drive link on the document.
- New trainer page "My approved documents" for the current session: lists each approved/archived document with view + download of the signed copy (and the Drive link when present).

## Technical notes

- Files touched: `src/lib/sessions.ts`, `src/data/mockData.ts`, `src/pages/admin/ApprovalPolicies.tsx`, `src/pages/admin/EfficiencyDashboard.tsx`, `src/pages/iqa/VerifierPacks.tsx` (document type list); `src/lib/notify.ts`, `StatusBadge`, `DocStatusTimeline`, `ProgressTracker`, `RoleGuideCard`, IQA pages (labels + messages); `src/hooks/useDocuments.ts` and `supabase/functions/stamp-document/index.ts` (layout-first stamping, mirror guard); `PlacementModal`, `BulkSignButton` (dialog lifecycle); `UploadDocuments.tsx`, `MySubmissions.tsx`, `RejectedResubmitButton` (resubmission lock and rejection cards); new trainer approved-documents page and route.
- No schema migration required except an optional index-free query for the trainer approved list; enum values stay as-is to preserve existing rows.
