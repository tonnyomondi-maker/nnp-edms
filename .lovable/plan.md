## Why sessions "can't be set" today

The Academic Sessions screen exists at `/admin/session-config` and the Templates screen at `/admin/templates`, but neither appears in the admin navigation (`BottomNav` only links Exports, Setup, Docs, Efficiency, Users, Audit). They're reachable only by typing the URL. That's the root cause — plus the session screen shows raw codes (`SEP_DEC 2026`) instead of readable labels.

## 1. Make sessions configurable and visible

- Add **Sessions** and **Templates** entries to the Super Admin navigation, and add both as cards on the System Setup page.
- Rework the Academic Sessions screen:
  - Year picker defaulting to the current year (2026) with a few years either side.
  - Term picker showing "January – April", "May – August", "September – December".
  - Quick "Create the three sessions for &nbsp;" button.
  - Existing sessions listed as "September – December 2026" with status, window dates and a "Make current" action. 
  - Let the terms remain but let the admin type the academic year for flexibility

## 2. Session becomes the enforced default everywhere

- **Trainer upload**: session year/term pre-filled from the admin-set current session and locked (read-only, with a note naming the open session). Submissions still validated against the open/close window and grace days already implemented.
- **Higher roles** (HOD, DP Academics, IQA, Super Admin): add a **Session** option to the group-by control and a session filter, with session as the default top-level grouping; Term/Module stays available as the secondary grouping.
- **Trainer history**: add a session selector on My Submissions so trainers can browse previous sessions' documents read-only, including items already offloaded to Google Drive (link opens the Drive copy when the cloud file has been tiered away).

## 3. New weekly document type: Records of Work Covered

- Add to the weekly document types, so it uses the existing week-number field like Session Plan and Class Attendance.
- Expected count per unit per session = 2; the trainer progress tracker and HOD/Reports completeness counts are updated to expect two submissions.
- The type is added to the approval-policy and SLA target lists so signature/stamp rules can be set for it.

## 4. Templates: admin publishes, everyone uses

- Templates admin screen gets multi-file upload (drag several files, set type/department per row) so you can load the whole set in one pass, plus visible download counts and active/inactive toggles.
- Trainers already see the `TemplateLibraryPanel` on upload; it will be filtered to the document type being uploaded and shown expanded when no submission exists yet for that type.
- **New**: the same template panel appears for HOD, DP Academics and IQA on each document review, showing the approved sample for that document type side-by-side with the submission so verification is consistent.

## 5. Onboarding / screen guides per role

- A dismissible "What you need to do" card on each role's dashboard listing that role's responsibilities and next actions, with links.
- A first-login guided tour (3–5 steps) per role highlighting the key screens, replayable from a "?" button in the top bar. Dismissal state stored per user so it never nags.

## 6. Footer and copyright

- Rebuild the footer with clearer credit blocks: institution (logo, name, motto, website) on one side, a separated "Developed by the Office of the Systems Administrator" credit visually distinct with a divider, and the copyright line using a live `new Date().getFullYear()` (already dynamic — it will stay dynamic and be given its own line with the system version).

## Advice: what helps vs. what would hinder

- Locking the session is safe **only** with an admin override — I'll keep an admin/HOD "allow late submission" path so a closed window never hard-blocks legitimate work.
- Keep the guided tour dismissible and never modal-blocking, so experienced trainers aren't slowed down.
- Don't make templates mandatory-to-download before upload; that adds friction with no compliance benefit.

## Technical notes

- Migration: extend the document-type list used by `document_type_policy` / `sla_targets` seeds with "Records of Work Covered"; add a `download_count` column to `document_templates`; add a `user_onboarding` table (per-user, per-role tour completion) with RLS scoped to `auth.uid()` and the required grants.
- Frontend: `src/lib/sessions.ts` (WEEKLY_DOC_TYPES), `GroupByControl` (new `SESSION` key), `SessionConfig`, `Templates`, `UploadDocuments`, `MySubmissions`, `BottomNav`, `SystemSetup`, `Footer`, plus a new `RoleGuideCard` / `GuidedTour` component pair.
- Since your template files didn't attach, the upload screen is built for you to load them yourself; re-attach them any time and I'll ingest them.