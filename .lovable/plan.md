## Plan: Simplify Trainer Upload + Session-Aware Workflow

### Goal

Remove the "teaching assignment" requirement. Trainers pick department, type the unit, choose doc type(s), and upload — directly tagged to the active training session (Term 1/2/3).

### 1. Concept changes

- **Drop assignment dependency**: documents no longer require `assignment_id`. Trainers self-declare unit + department + class on submit.
- **Active session**: every upload is automatically tagged with the current term (Jan–Apr / May–Aug / Sep–Dec) derived from `submitted_at`, OR with a session the trainer explicitly selects from a dropdown (current + previous so they can backfill).
- **Per-unit session config**: when a trainer first uses a unit in a session, they set `sessions_per_week` (1–5). This drives how many weekly Session Plans + Attendance records are expected.
- **Multi-file upload**: one form lets the trainer attach several PDFs at once — system creates one document row per file using the chosen doc type(s).

### 2. Database changes (migration)

On `documents`:

- Make `assignment_id` **nullable** (keep column for backwards-compat with already-submitted docs)
- Add `unit_code TEXT`, `unit_name TEXT`, `class_code TEXT` (denormalized, trainer-entered)
- Add `session_year INT`, `session_term TEXT` (`JAN_APR` | `MAY_AUG` | `SEP_DEC`)
- Add `sessions_per_week INT` (nullable, only relevant for weekly docs)

New table `unit_session_config`:

- `id`, `trainer_id`, `department`, `unit_code`, `session_year`, `session_term`, `sessions_per_week`, `created_at`
- Unique constraint on (`trainer_id`, `unit_code`, `session_year`, `session_term`)
- RLS: trainers manage their own rows; HOD/DP/IQA can view

### 3. New trainer upload page

Replace `SubmitDocument.tsx` flow with a single `/upload` page:

- **Session**: dropdown defaulting to current term (e.g. "Term 2 — May–Aug 2026"), with previous 2 selectable
- **Department**: dropdown (same list used elsewhere)
- **Unit code + Unit name**: text inputs (autocomplete from trainer's previous uploads in same session)
- **Class code**: text input
- **Sessions per week**: number input (1–5), only shown when a weekly doc type is selected; saved/loaded from `unit_session_config`
- **Document type(s)**: multi-select grouped into:
  - *One-time* (Learning Plan, Personal Timetable, Course Outline, Workload Allocation, Scheme of Work, Records of Work Covered)
  - *Weekly* (Session Plan, Class Attendance) — when chosen, show week-number picker and a session-index picker (1..sessions_per_week)
- **Files**: multi-file picker; each file gets paired with a doc type (auto-paired if only one type selected, otherwise dropdown per file)
- Submits one row per file with the session metadata baked in

Duplicate guard:

- One-time docs: blocked if same (unit_code, doc_type, session_year, session_term) already exists & not rejected
- Weekly docs: blocked if same (unit_code, doc_type, week_number, session_index, session_year, session_term) exists & not rejected

### 4. Update existing screens

- `MyTeaching.tsx` → repurpose as **"My Units (this session)"**: groups documents by `unit_code` within the active session, shows completion vs expected (one-times + sessions_per_week × weeks).
- `MySubmissions.tsx`, `DocumentCard`, HOD/DP/IQA queues → display `unit_code` / `unit_name` / `class_code` from the document row directly when `assignment_id` is null.
- `SessionExports.tsx` → switch the bucketing source from `archived_at` to `session_year` + `session_term` so an admin exports exactly what trainers tagged.
- Sidebar: keep "Teaching Assignments" admin page but mark it as optional/legacy (used only for HOD scoping).

### 5. RLS

- `documents` insert policy: still `trainer_id = auth.uid()`. Add CHECK that `session_year` and `session_term` are present.
- `unit_session_config`: trainer CRUD on own rows; HOD/DP/IQA SELECT.

### Files

**Create**

- `src/pages/trainer/UploadDocuments.tsx` (replaces SubmitDocument flow)
- `src/hooks/useUnitSessionConfig.ts`
- Migration: doc columns + new table + RLS

**Modify**

- `src/hooks/useDocuments.ts` — `useSubmitDocument` accepts session fields + multi-file; new `useMyDocumentsBySession`
- `src/App.tsx` — add `/upload` route, keep `/submit/:assignmentId` for legacy
- `src/pages/trainer/MyTeaching.tsx` — group by unit within active session
- `src/components/common/DocumentCard.tsx` — show denormalized unit info
- `src/pages/admin/SessionExports.tsx` — bucket by `session_term`/`session_year`
- `src/components/layout/BottomNav.tsx` — point trainer primary action at `/upload`

### Open question

Backfill: existing documents have `assignment_id` and no `session_year` / `session_term`. Plan is to derive their session from `submitted_at` in the migration so old data still appears in session reports. Confirm OK. or we can let the admin set the training session and the year for document submission