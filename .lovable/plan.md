# Verifier Packs — Capacity, Bulk Assign, Timeline, Reminders

Four related additions on top of the existing verification-pack system. IQA and Super Admin only.

---

## 1. Department pack-capacity settings

**Goal**: Replace the hard-coded default `_capacity = 10` in `verification_pack_stats*` with a per-department, configurable limit.

**Schema**: new table `department_pack_capacity`
- `department text primary key`
- `active_pack_limit int not null default 10 check (active_pack_limit between 0 and 200)`
- `updated_by uuid`, `updated_at timestamptz default now()`

RLS: SUPER_ADMIN / IQA read + upsert; authenticated read (needed by analytics panel). GRANTs for `authenticated` + `service_role`.

**Function updates**:
- Rewrite `verification_pack_stats(_department)` and `verification_pack_stats_by_dept()` to LEFT JOIN `department_pack_capacity` and fall back to 10 when no row exists. Drop the `_capacity` argument (keep it as a defaulted arg for backward compat, but ignore when a per-dept row exists).

**UI**: new page `src/pages/iqa/PackCapacity.tsx`
- Grid of departments × current limit + active count + a number input + "Save" per row.
- Bulk "Reset to 10" action.
- Linked from `VerifierPacks` header ("Capacity settings") and from `BottomNav` under IQA / Super Admin.

The `PackAnalyticsPanel` progress bars pick up the new limit automatically.

---

## 2. Bulk verifier assignment

**Goal**: Assign the same set of verifiers to many packs in one flow.

**UI**: new page `src/pages/iqa/BulkAssign.tsx`
- Filters: department (default: all the user is allowed to see), session year, term, status (default: Active).
- Left column: paginated list of packs matching filters with per-row checkbox + "select all filtered".
- Right column: multi-select of verifiers (reuses the picker from `AssignVerifiersModal`, filtered by department if a single dept is selected).
- Bottom bar: "Assign N verifiers to M packs" button + summary.

**Behaviour**: on submit, upsert `verification_pack_assignees(pack_id, verifier_id)` for every (pack, verifier) pair; unique constraint handles duplicates. Show per-pack success/failure counts in a toast + collapsible report.

Entry point: button on `VerifierPacks` next to "Create new pack" and a nav item under IQA.

---

## 3. Per-document audit timeline

**Goal**: For any document that's part of a pack, show a chronological timeline of pack membership, verifier opens/downloads, and review decisions.

**Data sources** (all existing):
- `verification_packs` (created_at, expires_at, revoked_at) filtered to packs whose scope matches the document.
- `verification_pack_assignees` (`first_opened_at`).
- `audit_logs` rows already emitted: `PACK_DOWNLOADED`, `VERIFIER_REVIEW_SUBMITTED`, plus a new `PACK_OPENED` we'll emit from `download-verification-pack` when a verifier hits the landing page.
- `verifier_reviews` (reviewed_at, decision, notes, verifier_id).

**RPC**: `document_pack_timeline(_document_id uuid) returns jsonb[]` — SECURITY DEFINER, IQA/SUPER_ADMIN only. Aggregates the four sources into a single time-ordered array of `{ ts, kind, actor, meta }` events.

**UI**: new component `src/components/iqa/DocumentAuditTimeline.tsx`
- Vertical timeline with icon per kind (pack created / verifier assigned / verifier opened / verifier downloaded / review submitted / pack revoked).
- Rendered:
  - inline in `PackReviews.tsx` under each document row (expand/collapse).
  - as a modal from `ArchiveScreen` on the "History" action for archived documents.

No new tables.

---

## 4. Automatic reminder notifications (24h)

**Goal**: If a verifier opens a pack (recorded via `first_opened_at`) but hasn't submitted any `verifier_reviews` row for the pack within 24 hours, send them one reminder email.

**Schema**: extend `verification_pack_assignees`
- `reminder_sent_at timestamptz` (null = not sent).

**Edge function**: new `send-verifier-reminders` (verify_jwt = false; runs from cron)
- Selects assignees where `first_opened_at < now() - interval '24h'` AND `reminder_sent_at is null` AND pack is active AND no `verifier_reviews` exist for `(pack_id, verifier_id)`.
- For each, fetches the verifier email and sends a Lovable app email (`verifier-review-reminder` template) with the pack link (`&v=<verifier_id>`).
- Stamps `reminder_sent_at`.
- Emits `audit_logs` action `VERIFIER_REMINDER_SENT`.

**Email**: new React Email template `_shared/transactional-email-templates/verifier-review-reminder.tsx` (branded, single CTA to open pack). Registered in `registry.ts`.

**Scheduling**: pg_cron job runs the edge function every hour (uses `SUPABASE_ANON_KEY` + service invocation pattern from the existing scheduled-job docs).

**Prerequisites (auto-detected)**:
- If Lovable Emails infra isn't set up yet, run `email_domain--setup_email_infra` and `email_domain--scaffold_transactional_email` before wiring the function/cron. If no email domain is configured, prompt the user to set one up in that turn.

**IQA visibility**: reminder timestamp shown in `AssignVerifiersModal` and the new timeline (kind `reminder_sent`).

---

## Files

**New**:
- `src/pages/iqa/PackCapacity.tsx`
- `src/pages/iqa/BulkAssign.tsx`
- `src/components/iqa/DocumentAuditTimeline.tsx`
- `supabase/functions/send-verifier-reminders/index.ts`
- `supabase/functions/_shared/transactional-email-templates/verifier-review-reminder.tsx`
- migration `..._pack_capacity_reminders_timeline.sql`

**Edited**:
- `src/App.tsx` (new routes)
- `src/components/layout/BottomNav.tsx` (nav entries)
- `src/pages/iqa/VerifierPacks.tsx` (links to capacity + bulk assign; drop the local capacity constant)
- `src/pages/iqa/PackReviews.tsx` (embed timeline)
- `src/pages/iqa/ArchiveScreen.tsx` (history modal)
- `src/components/iqa/PackAnalyticsPanel.tsx` (use RPC-provided capacity)
- `src/components/iqa/AssignVerifiersModal.tsx` (show `reminder_sent_at`)
- `supabase/functions/download-verification-pack/index.ts` (emit `PACK_OPENED` on landing hit; keep download event)
- `supabase/functions/verifier-review-submit/index.ts` (unchanged event stream)
- `supabase/config.toml` (new function)

---

## Notes / order

1. Migration (tables, capacity, RPC, timeline RPC, reminder column).
2. Email infra + reminder template + edge function + cron.
3. IQA screens (capacity, bulk assign, timeline, modal wiring).
4. Nav + routes.

All new tables scoped by RLS to IQA / SUPER_ADMIN via `has_role`. No `anon` grants. Reminder emails obey suppression via Lovable's send function.
