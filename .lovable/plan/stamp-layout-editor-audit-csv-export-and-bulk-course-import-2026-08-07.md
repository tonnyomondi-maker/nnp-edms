# Stamp layout editor, audit CSV export, and bulk course import

## 1. Admin stamp-layout editor (`/admin/stamp-layouts`)

New Super Admin page listing every saved layout version with its status (Active / Draft).

- **Create / duplicate** a layout: name, version number, header title.
- **Per stage** (Head of Department, Internal Quality Assurance, Deputy Principal — Academics) set: display title, order, slot height, signature width & height, stamp size, and title font size.
- **Live preview** beside the form using the existing approval-sheet preview component, so changes are visible before saving.
- **Activate**: one click makes a version the one used for all future approvals; the previously active version is deactivated automatically.
- **Delete** draft versions (the active one cannot be deleted).
- Linked from the admin navigation.

## 2. Per-document stamping & audit trail CSV

On the admin All Documents view, each document gets an "Audit CSV" action next to the existing PDF audit button. It downloads a spreadsheet-friendly file containing every recorded event for that document: timestamp, action, old/new status, stage, stage order, stamp version, layout version, performer name and email, and remaining detail fields. Also available as a bulk "Export audit CSV for filtered documents" action at the top of the list.

## 3. Bulk course import from Excel

On the Courses page:

- **Download template** produces an `.xlsx` with the columns `department`, `code`, `name` plus one example row and a sheet listing valid department names.
- **Bulk upload** accepts `.xlsx`/`.csv`, parsed in the browser.

## 4. Import preview with row-level validation

Before anything is written, a preview table shows each parsed row with a status chip:

- Error — unknown department, missing code or name, code longer than allowed, or a duplicate `department + code` inside the file.
- Update — the course already exists and will be overwritten with the new name.
- New — will be created.

Row errors are shown inline with the row number and the reason. Rows with errors are excluded; the confirm button reports how many will be created and updated, and is disabled if every row fails. A Head of Department importing is locked to their own department, and rows for other departments are flagged as errors.

## Deployment readiness check (documents upload)

Checked against the live backend — the upload-to-archive pipeline is working:

- Storage buckets (documents, signatures, templates, backups) exist and are private.
- Two real documents have completed the chain through DP approval and archival; both carry a signed/stamped file and both mirrored to Google Drive successfully.
- One current academic session (Sept–Dec 2026), 4 published templates, 5 profiles and 10 role assignments are in place.
- One active stamp layout exists, so approvals already have a layout to render from.

Two gaps to be aware of before wider rollout, neither blocking:

- Only 1 course exists, so trainers have almost nothing to pick from when keying units — the bulk import in this plan is the fix.
- Approvers must each set up a signature (and stamp where the policy requires one) in Profile Settings before they can approve; that is enforced at approval time with an error message.

## Technical notes

- No schema changes. `stamp_layouts`, `audit_logs`, and `courses` already have the needed columns, policies, and grants.
- New page `src/pages/admin/StampLayouts.tsx` using the existing `useStampLayouts` / `useSaveStampLayout` / `useActivateStampLayout` / `useDeleteStampLayout` hooks; route added in `App.tsx` and a nav entry in the admin menu.
- New `src/lib/auditCsv.ts` builds CSV rows from `audit_logs` joined to performer profiles; a small `AuditCsvButton` mirrors the existing `AuditTrailButton` styling.
- Course import uses the already-installed `xlsx` package client-side; the confirm step calls the existing `courses` upsert on `department,code` in batches, so re-uploads update rather than duplicate.
