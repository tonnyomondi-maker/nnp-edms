## 1. Approval workflow review (Trainer → HOD → DP Academics → IQA)

Current flow, as implemented today:

```text
Trainer                HOD                    DP Academics            IQA
-------                ---                    ------------            ---
UploadDocuments  ->  DepartmentQueue    ->   ApprovalQueue      ->   ArchiveScreen
status=SUBMITTED     status=HOD_APPROVED     status=DP_APPROVED      status=ARCHIVED
                     (own dept only)         (all depts)             (+ Early Access,
                                                                      Verifier Packs)
```

What is working well:

- `guard_document_update` trigger enforces valid transitions and blocks self-approval and payload tampering by approvers.
- Each stage supports **Quick Verify** (text-only stamp) and **Sign & Approve** (PDF placement of signature + stamp) — governed per document type by `document_type_policy` (`stamp_required`, `signature_only_allowed`, `forbid_text_only_fallback`).
- `stamp-document` edge function embeds the signature/stamp and returns a `signed_file_url` that becomes the source for the next stage.
- Bulk approve/reject at every stage, with `ActionGuardButton` disabling actions when the active role can't act.
- Rejection returns the doc to the trainer with a reason; the trainer resubmits from `MySubmissions`.
- IQA has Early Access (with DPA-2019-logged reason) and Verifier Packs.

Confirmed gaps to fix in this plan:

- **No "return to previous stage"** — DP can only approve, reject-to-trainer, or leave pending; same for IQA. A minor-fix path back to HOD would prevent full rejections for trivial issues.
- **No visible SLA / age indicators** on queue cards — stale items are invisible until someone scrolls.
- **No trainer-facing progress tracker** — `MySubmissions` shows status badges but not a visual HOD → DP → IQA pipeline per doc.
- **No sample/template library** — trainers re-invent formats each term.
- **Session config is per-trainer only** (`unit_session_config`) — there is no institution-wide "current session / open window" that Admin controls.
- **No AI assistance** anywhere in the pipeline.

## 2. What this plan builds

### A. Admin-controlled academic session (institution-wide)

New table `academic_sessions` (Super Admin managed):

- `session_year`, `session_term` (JAN_APR / MAY_AUG / SEP_DEC)
- `status`: `PLANNED | OPEN | LOCKED | CLOSED`
- `submission_opens_at`, `submission_closes_at`
- `late_submission_grace_days`
- `is_current` (only one true)

Enforcement:

- Trainer `UploadDocuments` reads the current `OPEN` session and pre-selects year/term; other sessions become read-only.
- `useSubmitDocument` checks the session status; blocks inserts when `CLOSED` or outside window (except Super Admin override).
- New Admin page `/admin/session-config` to create/open/lock/close sessions and set the current one.
- Existing per-trainer `unit_session_config` stays for sessions-per-week / course type — only the *window* is centralized.

### B. Sample templates library for trainers

New table `document_templates` (Super Admin uploads, all trainers download):

- `document_type`, `title`, `description`, `department` (nullable = all), `file_path` (storage), `is_active`, `version`.
- Storage: new **private** `templates` bucket. RLS: `SELECT` for `authenticated`; `INSERT/UPDATE/DELETE` for Super Admin only.

UI:

- New `/admin/templates` page for Super Admin to upload/replace/retire samples of approved documents (Scheme of Work, Session Plan, Course Outline, Learning Plan, Class Attendance, etc.). Also let the admin to be able to select from the system to transfer to templates
- New "Sample templates" panel on trainer `UploadDocuments` — filters by department + document type, shows version and download link with signed URL.
- Empty-state hint in `MySubmissions` links to the library.

### C. Workflow efficiency improvements

1. **Trainer progress tracker** — Small horizontal pipeline (Submitted → HOD → DP → IQA) rendered on each `DocumentCard` in `MySubmissions`, using existing timestamps (`hod_approved_at`, `dp_approved_at`, `archived_at`).
2. **Queue age badges** — Add "N days pending" pill to `DocumentCard` when `showTrainer` is on and status is a queue status; red when > SLA (default 3 days, configurable in `system_settings`).
3. **Return-for-minor-fix** — Add a `RETURNED_TO_HOD` soft path: DP/IQA can send back with a note to the previous stage instead of rejecting to the trainer. Implemented as a new `documents.return_note` + status transitions in the `guard_document_update` trigger. New button "Return to previous stage" on DP/IQA cards. Purely additive — trainers never see it as a rejection.
4. **Digest notifications** — Extend `notifications` (already present) with a daily per-role digest ("You have 12 items awaiting HOD verification") via a cron on `send-verifier-reminders` sibling function.

### D. AI integration (Lovable AI Gateway — `google/gemini-3.6-flash`)

Four focused, high-value uses, each an edge function:

1. `**ai-approval-summary` (HOD / DP / IQA)**
  - One-click "Summarise for review" button on `DocumentCard` at approver stages.
  - Returns: 3-line summary, list of detected sections, any missing CBET/CDACC-required items, and a suggested verdict (approve / return / reject with reason). Approver still clicks the actual action.
2. `**ai-rejection-drafter` (all approver stages)**
  - When approver clicks Reject, opens a dialog with an AI-drafted rejection reason built from the checklist. Approver edits and confirms.
3. `**ai-verifier-brief` (IQA verifier packs)**
  - When generating a verifier pack, attach a Gemini-generated cover note per document summarising what the verifier should look at. Written to the ZIP as `README.md`.

All calls guarded by `useRoleGuard` on the client and role checks in the edge function. `LOVABLE_API_KEY` is already provisioned.

### E. Small retrieval improvements

- Add full-text search on `documents.file_name`, `unit_code`, `unit_name`, trainer name (via `profiles`) to `MySubmissions` and IQA `ArchiveScreen`.
- Add "Copy sharable archive link" (already-signed URL, IQA only) on archived docs.

## Technical notes

Schema (single migration, follows GRANT rules):

- `academic_sessions` — Super Admin write, authenticated read; trigger to keep only one `is_current = true`.
- `document_templates` — Super Admin write, authenticated read.
- `documents`: add `return_note text`, `returned_at timestamptz`, `returned_by uuid`.
- Extend `guard_document_update` trigger with `DP_APPROVED -> HOD_APPROVED` (return) and `ARCHIVED -> DP_APPROVED` (return) allowed for DP/IQA respectively when `return_note` is set.
- New `templates` storage bucket (private) via `supabase--storage_create_bucket`; RLS on `storage.objects` for Super Admin write, authenticated read.

Edge functions (all use Lovable AI Gateway helper already in `_shared/ai-gateway.ts`):

- `ai-document-check`, `ai-approval-summary`, `ai-rejection-drafter`, `ai-verifier-brief`.

Frontend:

- New pages: `/admin/session-config`, `/admin/templates`.
- New components: `<ProgressTracker doc={...}/>`, `<AgePill submittedAt=... status=.../>`, `<TemplateLibraryPanel/>`, `<AiCheckPanel/>`, `<AiSummaryButton/>`, `<ReturnToPreviousDialog/>`.
- Extend `useRoleGuard` with `canManageSessions`, `canManageTemplates`, `canReturnToPreviousStage`.
- Extend `useSubmitDocument` to consult `academic_sessions` before insert.

Rollout is additive — no existing screen is removed and every new capability is behind a role guard or a policy flag.

## Out of scope for this plan

- Rebuilding the placement/stamp UI.
- Replacing the Google Drive backup path.
- Verifier pack schema changes (only the AI brief is added).

## Open questions before build

1. For the AI checks — do you want AI to be able to **block submission** when a required CDACC section is missing, or always advisory only? No. And wont this  be credit intensive?
2. Templates library: department-scoped only, or should Super Admin also be able to publish per-course templates?department-scoped only
3. For the "return to previous stage" path — should the trainer see it at all in their timeline, or should it be invisible to trainers (approver-side only)?trainer see it at all in their timeline
4. can we have verified by HOD and Approved by D/P academics emebeded at the final stage