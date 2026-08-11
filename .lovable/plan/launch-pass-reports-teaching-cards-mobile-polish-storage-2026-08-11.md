# Launch pass: reports, teaching cards, mobile polish, storage

## 1. Reports rebuilt and correctly wired

Current Reports counts every uploaded row, so a Learning Plan rejected three times and re-uploaded counts as four documents — that is the false 4/4. Fix by counting **coverage per document type per unit**, never row counts.

New rules:
- Expected = (units configured for the selected session) x (one-time document types).
- Covered = distinct (unit, document type) pairs that have a live document in a non-rejected state. Superseded versions and rejection history never add to the count.
- Rejected and pending are reported separately as *status* figures, not as coverage.
- Everything is filtered by the selected **training session** (year + term), defaulting to the current admin-configured session. Reports currently apply no session filter at all.

Scope by role: HOD sees their department, IQAO and Deputy Principal Academics see all departments, Super Admin sees all plus per-trainer detail. Trainers keep a personal view.

Tabs: Coverage (per trainer), Missing (per unit), Department (percentages), Flow (stage counts and cycle times).

**PDF export**: an "Export PDF" button on each report producing a paginated document with the institution header, session label, scope, generated-on timestamp, summary figures and the detail tables. Available to HOD, IQAO and Super Admin.

## 2. MyTeaching pending-document cards

Each unit card gains:
- A compact progress bar: covered vs required one-time documents for the selected session.
- A list of the missing types as chips ("Missing: Learning Plan, Course Outline").
- Any type currently rejected shown as an amber "Needs correction" chip linking to the edit-and-resubmit flow.
- A direct **Upload workload allocation** action on the unit card (pre-fills unit, course, session and document type in the upload form) plus a generic "Upload for this unit" shortcut.

Units fully covered collapse to a green "Complete" state to keep the page short.

## 3. Mobile polish

- Single-column cards everywhere; no horizontal scrolling tables — tables become stacked rows below `sm`.
- Filter/group controls collapse into one bottom "Filters" sheet on small screens, showing an active-filter count.
- All primary actions at least 44px tall; approve/reject sit in a sticky bottom action bar above the bottom nav on document detail and bulk screens.
- Long unit/course names truncate with a tap-to-expand rather than wrapping the layout.
- Dialogs (reject, placement, resubmit) become full-height sheets on mobile.

## 4. Rejected-document storage strategy

Recommended and implemented behaviour:
- On resubmission the superseded file stays retrievable for a grace window (default 14 days), then the object is deleted from Cloud storage. The `document_rejections` row, reason, office, date and version are kept forever, so verifiers can always compare corrections.
- Documents rejected and never corrected keep their file until the session closes, then only the record survives.
- Nothing rejected or superseded is ever mirrored to Drive — Drive stays approved-only.
- Grace window is a Super Admin setting; a scheduled cleanup reports how many objects and bytes it reclaimed, and a Storage Audit panel shows reclaimable space before it runs.

The "Previously rejected" banner and the reason history are unaffected by cleanup — only the bytes go.

## 5. Exports move to Super Admin

- `/admin/exports` is removed from the Deputy Principal Academics navigation and appears in the Super Admin navigation; IQAO keeps its department/trainer archive ZIPs.
- Efficiency improvements: server-side filtering before the ZIP is built, streaming entries instead of buffering the whole archive, skipping documents already exported unless "re-export" is ticked, batched Drive fetches with retry, and the existing live progress panel reporting processed/skipped/retried per batch.

## Technical notes

- `src/pages/Reports.tsx` rewritten around a session-scoped query and a coverage matrix keyed by `unit_code + document_type`, excluding `REJECTED` from coverage; a shared `lib/reportMetrics.ts` holds the aggregation so PDF and screen use identical numbers.
- PDF generation via `jspdf` + `jspdf-autotable` (new dependency), client-side.
- `MyTeaching.tsx` computes per-unit coverage from the same helper; upload shortcuts pass query params consumed by `UploadDocuments.tsx`.
- Retention: `retention_grace_days` on `system_settings`, a cleanup edge function deleting superseded storage objects, and `previous_file_url` cleared when purged.
- Export function: batching and skip-already-exported logic in `export-session-zip`, plus route/nav changes for `/admin/exports` and a Super Admin check.
