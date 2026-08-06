# Approval sheet v2, notifications, bulk preview, and bulk course upload

## 1. Rebuild the approval sheet (3 approvers, no overlap)

The appended verification page becomes a clean three-slot layout:

```text
DOCUMENT APPROVAL & VERIFICATION SHEET
------------------------------------------------
1. VERIFIED BY HEAD OF DEPARTMENT
   [signature area]                  [stamp box]
   Name / Date & time
------------------------------------------------
2. VERIFIED BY INTERNAL QUALITY ASSURANCE
   [signature area]                  [stamp box]
   Name / Date & time
------------------------------------------------
3. APPROVED BY DEPUTY PRINCIPAL - ACADEMICS
   [signature area]                  [stamp box]
   Name / Date & time
------------------------------------------------
footer: archived by IQA on <date> · stamp v<x> · doc id
```

- IQA Archival loses its signature slot; archival is written as a one-line footer and stays in the audit trail.
- Slot heights are computed from the active layout version so signature and stamp images are always clipped inside their own slot — no overlap between stages.
- When an approver does not preview/position anything, the signature and stamp are auto-placed inside their slot at the default size for that stage.

## 2. Stamp template versions (configurable per stage)

New admin screen at `/admin/stamp-layouts`:

- Create named layout versions (e.g. "Standard 2026").
- Per stage (HOD / IQA review / DP) set: slot height, signature width & height, stamp size, title font size, and stage order.
- Mark one version as active; approvals use the active version and record its name + numeric version in the document and audit trail.

## 3. Notifications (in-app)

- New `notifications` table: recipient, document, kind (`APPROVED` / `REJECTED` / `RETURNED`), stage, stage order, stamp version, message, read flag.
- Written automatically when a document is approved, rejected or returned.
- `Notifications` page becomes a real feed with unread badge in the top bar; each entry shows stage ("Stage 2 of 3 — IQA review"), the stamp version applied, timestamp, and the rejection/return note when present.

## 4. Bulk preview then bulk approve

Extend the existing bulk sign flow:

- New "Preview & approve selected" action opens a stepper listing the selected documents with a rendered preview of the approval sheet as it will look for each one (including where this stage's signature lands).
- Reviewer can deselect any document from the preview list, then approve the whole remaining set in one submit, reusing the existing sequential bulk approval with progress and per-document failure reporting.

## 5. Export stamping/audit trail as CSV

- On the admin document view, a "Export audit trail (CSV)" action per document downloads every audit event for that document: timestamp, action, stage, stage order, stamp version, performer name/email, mode, pages before/after, and details.

## 6. Bulk course upload from Excel

- On `/admin/courses`: "Download template" (XLSX with `department`, `code`, `name`) and "Bulk upload" file picker.
- Parsed client-side, validated (known department, non-empty code/name, duplicates flagged), shown in a confirm table with row-level errors, then upserted on `department,code` so re-uploads update instead of duplicating.

## Technical notes

- DB: `notifications` table (user-scoped RLS + grants), `stamp_layouts` table (admin write, authenticated read), plus `stamp_layout_version` / `stamp_stage_order` columns on `documents`.
- `supabase/functions/stamp-document`: replace the 4-slot `slotBox`/`STAGE_SLOT` logic with layout-driven geometry, bump `STAMP_VERSION` to `3.0.0`, insert the notification row, and keep the existing `DOCUMENT_STAMPED` audit entry with layout name and stage order.
- Rejection/return paths in `useDocuments.ts` also insert notification rows.
- `ApprovalSheetPreview.tsx` is refactored to render from the active layout config so preview and generated PDF stay in sync; reused by the bulk preview stepper.
- Excel parsing uses the `xlsx` package on the client; no backend involvement.
