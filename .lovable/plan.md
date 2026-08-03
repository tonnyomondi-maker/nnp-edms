## Status of the four items you asked me to check

| Item | State today |
|---|---|
| Role-based onboarding guide | Partly. `RoleGuideCard` shows per-role steps but is only dismissable — there is **no per-step checklist you can tick off**, and no "update your profile" step. |
| Default grouping by academic year/term for higher roles | Partly. The `SESSION` grouping option exists in `GroupByControl`, but higher-role screens still default to no grouping / term-module. |
| Admin template publishing + trainer download | Done. `/admin/templates` (multi-file upload, publish toggle) and `TemplateLibraryPanel` on the upload + approver screens. |
| Records of Work Covered, twice per session | Done as a weekly type with an expected count of 2 per session. |

Verified in code this turn: `src/components/common/RoleGuideCard.tsx`, `src/components/common/GroupByControl.tsx`, `src/pages/admin/Templates.tsx`, `src/lib/sessions.ts`. There is currently **no courses table** in the database, and `gdrive-upload` is invoked immediately after a trainer upload (`src/hooks/useDocuments.ts`), which is what is filling Drive with unapproved files.

---

## 1. Department → Course → Unit hierarchy

New tables: `courses` (department, code, name, active) and a rework of `unit_session_config` so every unit row references a course. Super Admin and HODs manage courses; HODs only for their own department.

The Units tab (`My Teaching`) becomes pure data entry:
- Pick session (**locked to the admin's current session** — the current bug where it uses the device date is fixed by reading `useCurrentSession`).
- Pick course (filtered to the trainer's department), then add units: code, name, class code, sessions/week, module number.
- No document uploads there except one **Workload Allocation** per session, which is the only proof HODs use to confirm all units were keyed.

## 2. Upload tab driven by units

- Unit field becomes a **dropdown of the trainer's own units** for the current session (name + code), replacing free text. No units keyed → the form points them to the Units tab.
- Course, class code, sessions/week, module are auto-filled from the chosen unit and read-only.
- **"Term (intake stage)" selector removed** from the submission form entirely; grouping uses session + module.
- The templates panel stays right above the file picker so samples can be downloaded first.
- Upload accepts **PDF and images only**. `.doc/.docx` is rejected up front with: "Signatures and approval pages can only be applied to PDFs — please export your document as PDF before uploading." (Word files can't be stamped, so allowing them would break the whole approval chain.)

## 3. HOD filters

Department queue and HOD dashboard gain a **course filter** on top of the existing trainer grouping, so HOD works per course → per trainer.

## 4. Re-ordered approval chain

New pipeline: **Trainer → HOD verifies → IQA reviews → DP Academics approves → IQA archives.**

- Add an `IQA_REVIEWED` status between HOD approval and DP approval.
- IQA gets a "Review queue" (HOD-verified docs) separate from its existing "Archive" screen (DP-approved docs).
- DP queue now reads IQA-reviewed docs; DP return sends back to IQA, IQA return sends back to HOD.
- Progress tracker, timeline, dashboards, SLA stages and efficiency metrics all updated to the four-stage order.

## 5. Signatures without opening every document

- Manual drag-to-place stays for single approvals.
- For **bulk approval**, the system appends an **auto-generated approval page** at the end of the PDF: a table of Stage / Name / PF / Date with each approver's signature image and stamp rendered into it. One page accumulates all four stages rather than one page per approver — later approvers append a row to the existing page.
- HOD onboarding gains an explicit "Set up your signature and stamp" step linking to Profile Settings, and the HOD queue blocks sign-and-verify with a direct link if no signature is on file.

## 6. Google Drive: mirror only final documents

- **Remove** the automatic `gdrive-upload` call on trainer upload — raw submissions never leave Lovable Cloud.
- Mirror fires **once**, on DP Academics final approval (and again at IQA archival only if the file changed), so Drive holds the fully-stamped final PDF.
- Mirroring is idempotent: the existing `gdrive_file_id` is **updated in place** rather than creating a second copy, so an approved file replaces the earlier version instead of duplicating.
- Fix the **duplicated EDMS root folder**: `resolveRootFolder` will look up the mapped folder first and de-duplicate any existing EDMS folders into one mapped ID via the Re-link Drive folders action.
- Folder structure simplified to your spec: `EDMS / <Session> / <Department> / <Trainer PF - Name>` (module drops out of the path; it stays in the file name).

## 7. Onboarding checklist

`RoleGuideCard` becomes a persisted checklist: each step has a tick box saved per user and role, with a progress bar and a "hide when complete" behaviour. A **mandatory profile step** is added for all roles ("Complete your profile: full name, PF number, department, phone, signature") — until the profile is complete, the card cannot be dismissed and the dashboard shows a banner.

## 8. Default grouping

Higher-role views (HOD queue, IQA review/archive, DP queue, `/admin/documents`, Reports) default to **grouping by academic session**, with module as the secondary grouping.

---

## Performance notes

Beyond the above, the main delays come from per-document Edge Function round trips. I will batch bulk stamping into a single function call per batch instead of one per document, and drop the synchronous Drive call from the upload path (item 6), which is the single biggest upload latency win.

## Technical section

- Migrations: `courses` table + grants/RLS; `unit_session_config.course_id`; `IQA_REVIEWED` status value and transition rules in `guard_document_update`; `onboarding_progress` table (user_id, role, step_key, done_at).
- Edge functions touched: `stamp-document` (approval page renderer + batch mode), `gdrive-upload` (in-place update, simplified path), `drive-relink-folders` (EDMS de-dup).
- Frontend: `MyTeaching`, `UploadDocuments`, `DepartmentQueue`, `ApprovalQueue`, new IQA review screen, `ArchiveScreen`, `RoleGuideCard`, `ProgressTracker`, `DocStatusTimeline`, `GroupByControl` defaults.
