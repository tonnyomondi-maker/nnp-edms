# NNP ADMS — Phase 1 Storage Refactor

## Objective
Make Google Workspace/Google Drive the primary repository for academic document PDFs.
Supabase remains the database, authentication, workflow, audit and metadata layer.

## Document lifecycle
- 01 - PENDING: newly submitted and in-review documents.
- 02 - APPROVED - ARCHIVE: documents after final approval/archival.
- The same Google Drive file ID is moved from PENDING to APPROVED; it is not copied.

## Document placement
Session-level:
- Workload Allocation
- Personal Timetable

Unit-level, one-time:
- Learning Plan
- Course Outline

Unit-level, recurring:
- Session Plan
- Class Attendance
- Records of Work Covered

## Drive hierarchy
EDMS/
  01 - PENDING/
    <Session>/
      <Department>/
        <Course>/
          <PF - Trainer>/
            00 - Session Documents/
            01 - Units/
              <Unit>/

  02 - APPROVED - ARCHIVE/
    <same hierarchy>

## Code changes
1. `src/lib/sessions.ts`
   - Personal Timetable is now session-level.

2. `src/hooks/useDocuments.ts`
   - New submissions no longer upload the PDF to Supabase Storage.
   - The document metadata row is created first.
   - The PDF is sent directly to the `gdrive-upload` Edge Function as multipart data.
   - Resubmissions replace the same Drive file where a Drive file ID already exists.
   - Final approval/archival awaits Drive finalization instead of silently firing a background mirror.

3. `supabase/functions/gdrive-upload/index.ts`
   - Supports primary multipart uploads.
   - Builds lifecycle-aware PENDING/APPROVED folder trees.
   - Fails safely if the hierarchy cannot be created.
   - Finalizes a Drive-primary document by moving the same Drive file to APPROVED - ARCHIVE.

4. `supabase/functions/stamp-document/index.ts`
   - Reads Drive-primary PDFs from Google Drive.
   - Writes stamped/signed PDF bytes back to the same Drive file.
   - Keeps signatures/stamps in Supabase Storage because those are small assets, not academic document storage.

5. `supabase/functions/gdrive-download/index.ts`
   - New secure download/preview endpoint.
   - Verifies the user's access to the document before returning PDF bytes.

6. `src/hooks/useSignedDocUrl.ts`
   - Supports `gdrive://<fileId>` document references.
   - Creates browser object URLs from the secure Drive download endpoint.

## Important
This package is a working source-code refactor, NOT a claim of production validation.
Before deployment:
1. Apply the source changes to the GitHub branch.
2. Deploy the modified Edge Functions.
3. Confirm Google Drive connector secrets are present:
   - `LOVABLE_API_KEY`
   - `GOOGLE_DRIVE_API_KEY`
4. Test one real trainer submission.
5. Verify:
   - PDF appears in `EDMS/01 - PENDING/...`
   - Supabase `documents` Storage bucket does NOT receive the PDF
   - metadata row has `gdrive_file_id` and `storage_tier = drive`
   - HOD/IQA/DP stamping works
   - final approval moves the same file ID to `02 - APPROVED - ARCHIVE`
   - trainer can retrieve the approved document
   - admin export contains approved documents only

## Validation limitation
The source tree did not contain installed `node_modules`, and dependency installation timed out in the execution environment. Therefore a full Vite/TypeScript build was not completed here. Do not treat this package as production-tested until the project builds and the live Google Drive workflow is tested.

## Trainer UX refinement — 2026-08-17
- Trainer navigation now uses **My Teaching** instead of a generic Units label.
- My Teaching is the source of truth for session documents and unit responsibilities; it no longer presents a generic duplicate upload card for every unit.
- Session documents are grouped separately: Personal Timetable and Workload Allocation, each once per active session.
- Unit documents are grouped as once-per-unit: Learning Plan and Course Outline.
- Teaching records are grouped separately: Session Plan and Class Attendance weekly; Records of Work Covered has two explicit milestones — Mid-session and End-session.
- The generic Upload page is now a mobile-friendly collapsible launcher. Selecting a document type opens the same upload workflow with the type preselected.
- My Submissions remains the status/history register; Approved Documents is the retrieval library and separates session-level documents from unit documents.
- New trainer PDFs are uploaded directly to Google Drive PENDING storage. Supabase retains metadata/workflow/audit records; it is not the primary academic-PDF repository.

## Trainer fixes 1–5 — 2026-08-17

### Fix 1 — duplicate Drive invocation
- Confirmed `UploadDocuments.tsx` no longer invokes `gdrive-upload` after `useSubmitDocument()` completes.
- `useSubmitDocument()` is the single primary-upload path: it inserts metadata, sends the PDF as multipart data to `gdrive-upload`, and receives the Drive-backed result.
- The approval layer may still call `gdrive-upload` with `replace: true` at final approval/archival; that is intentional Drive finalization, not a second upload during trainer submission.

### Fix 2 — Personal Timetable / Workload Allocation must not become a unit
- `MyTeaching.tsx` now excludes `SESSION_LEVEL_DOC_TYPES` from the unit aggregation.
- Documents without a unit code are ignored by the unit map.
- This removes the previous `Unknown` pseudo-unit and keeps session documents exclusively under Current Session Documents.

### Fix 3 — explicit My Units section
- Added a clear `My Units` heading and explanatory text beneath the Current Session Documents card.
- Existing units, including `8785 — Computer Science`, remain the source of truth; no dummy unit is required.

### Fix 4 — post-upload navigation
- After a successful Google Drive submission, Upload Documents now presents three explicit actions:
  - Back to My Teaching
  - Upload another document
  - View submissions
- Navigation is manual rather than automatic so the trainer can still inspect the upload/Drive status.

### Fix 5 — trainer in-built guide
- The Trainer role guide now explains the distinction between session-level, once-per-unit, weekly and twice-per-session Records of Work Covered documents.
- It explicitly explains the post-upload navigation workflow and that the active session is carried forward automatically.
- The guide is surfaced on both My Teaching and Upload Documents.

### Validation performed in this environment
- TypeScript parser validation was run against the three changed files. JSX syntax errors introduced by the earlier malformed `Link`/`div` structure were corrected.
- A full Vite build could not be completed in this environment because the project's `node_modules` were not available and dependency installation timed out. The authoritative next validation remains the user's Windows project: `npm.cmd run build`.

### Next checkpoint
1. Run `npm.cmd run build` in the Windows `nnp-edms-main` directory.
2. Log in as `trainer@test.com`.
3. Confirm `My Teaching` shows `Current Session Documents` and a separate `My Units` section with `8785 — Computer Science`, without `Unknown`.
4. Submit one dummy PDF for Learning Plan or another allowed document.
5. Confirm it succeeds without `Edge Function returned a non-2xx status code` and shows `Stored in Google Drive`.
6. Confirm the new post-upload navigation buttons work.
7. Only after that proceed to Shared Drive support/configuration.
