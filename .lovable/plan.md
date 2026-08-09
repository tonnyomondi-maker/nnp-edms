# Hierarchy, reporting and bulk-ready workflow

A phased upgrade that makes queues hierarchical, resubmission safe and traceable, adds PDF submission reports, prepares the portal for many trainers and documents, and moves Drive to a course-aware folder tree — while keeping the interface simple and mobile-first.

## 1. Resubmission: lock the old version, flag the history

- When a rejected document is resubmitted, the same record is reused (already the case). The previously uploaded file becomes read-only: the old file link is kept as a superseded version, the trainer's card shows "Version 2 — replaces the rejected upload", and the old file can no longer be opened for editing or re-picked in the upload form.
- Every document gains a rejection history: how many times it was rejected, by which office (HOD / IQAO / DP), the reason, and the date.
- Verifiers see a prominent amber "Previously rejected" banner on the card with the last reason and rejecting office, plus a "Compare with previous reasons" expander. HOD, IQAO and DP all see it, so each stage can check the correction was actually made.
- Suggested supplement: an optional short "What I changed" note the trainer fills in when resubmitting, shown directly under the rejection banner. It costs the trainer one sentence and saves the approver a full re-read.

## 2. Storage savings on rejected documents

Recommended policy (configurable by the Super Admin):

- The rejected file is replaced by the corrected upload; the superseded file is deleted from Cloud storage after a grace window (default 14 days) once a newer version exists.
- Documents rejected and never corrected are purged after the training session closes, keeping the record row (audit trail, reason, dates) but not the bytes.
- Nothing rejected is ever mirrored to Drive — Drive stays approved-only.

## 3. Default grouping: training session everywhere

Every document list defaults to the current training session, with nested sub-groups per role:

```text
Trainer   : Session -> Unit
HOD       : Session -> Trainer -> Unit
IQAO / DP : Session -> Department -> Trainer -> Unit
Super Admin: Session -> Department -> Trainer -> Unit
```

Groups are collapsible, show counts and a pending badge, and open collapsed beyond the first level so a queue with hundreds of documents stays readable. The session filter is changeable; the grouping can be overridden but always resets to the role default.

## 4. Submission reports (PDF) for HOD, IQAO, Super Admin

A Reports screen with a session (and department, where allowed) selector producing an exportable PDF:

- Trainers who have submitted vs. expected, with completion percentage.
- Per-department and per-course completion percentages.
- Per-document-type coverage (which types are missing across the department).
- Stage breakdown: awaiting HOD / IQAO / DP, approved, rejected.
- Units allocated vs. units with a workload allocation on file.

Scope follows role: HOD sees their department, IQAO and DP see all departments, Super Admin sees everything plus per-trainer detail.

## 5. Bulk readiness

- Server-side pagination and search on all queues, so lists stay fast with thousands of rows.
- Bulk select across a whole group ("select all in this trainer / unit / department") with the existing bulk preview-and-sign flow, processed in batches with a progress bar and a per-document success/failure summary instead of one blocking spinner.
- Bulk reject with a shared reason, and bulk export.
- Drive mirroring queued and retried in the background rather than inline, so a batch approval never stalls on Drive.

## 6. Archive model

Archiving stays IQAO's final step, and means: final approved PDF mirrored to Drive, Cloud copy eligible for offload, document marked archived and locked from further changes, and included in the session ZIP. Once a session is closed, its archived documents become read-only history that trainers can still download.

## 7. Google Drive hierarchy

New tree: `EDMS / Session / Department / Course / Trainer / Unit / <documents>`.

Impact:

- Positive: matches how courses and units are now keyed, so exports per department, per course and per trainer fall out naturally.
- Negative: existing mirrored files sit in the old `Session/Department/Stage/Trainer` tree. Rather than a risky mass move, new mirrors use the new tree and a "Re-link Drive folders" run can migrate old files on demand.
- Deeper trees mean more folder lookups per upload; folder IDs are cached in the folder map to avoid slowing uploads.
- The export ZIP structure becomes configurable (by department, by course, by trainer), and only approved documents are ever included.

## 8. Workload allocation and unit cards

- Workload Allocation becomes a unit-scoped upload like the other one-time documents, so approvers can check every allocated unit is registered. A dedicated "Upload workload allocation" action appears on My Teaching.
- Each existing unit card lists the documents still pending for the current session (e.g. "3 pending: Learning Plan, Course Outline, Session Plan") with an upload shortcut.
- The upload session-restore prompt is removed; the form simply opens clean on the current session.

## 9. Simplicity and mobile

- Card-based, single-column layouts on small screens; filter and group controls collapse into one "Filters" sheet.
- Larger tap targets, sticky action bar for approve/reject, bottom navigation retained.
- Complexity (grouping, versioning, Drive routing) stays in the background — the trainer sees units and pending documents, the approver sees a grouped queue with clear flags.

## 10. System reset

Courses are exempted from the reset, alongside users, since they are admin-configured reference data.

## Technical notes

- Schema additions: `rejection_count`, `last_rejected_by`, `last_rejected_stage`, `previous_file_url`, `version`, `resubmission_note` on `documents`; a `document_rejections` history table; retention settings on `system_settings`.
- Grouping generalised into a multi-level grouping utility replacing the current single-level `groupDocs`, with role-based default configs.
- PDF reports generated client-side from aggregate queries (no new edge function unless volume requires it).
- `gdrive-upload` folder segments changed to session/department/course/trainer/unit with folder-ID caching in `drive_folder_map`.
- `system-reset` edge function keeps the `courses` table.
