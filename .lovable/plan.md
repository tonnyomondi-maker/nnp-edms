# Verifier Packs — Analytics, Composition, Assignment, Review

Four related additions on top of the existing verification-pack system. IQA and Super Admin only, gated per department.

---

## 1. Analytics panel (per department)

**Where**: New card at the top of `src/pages/iqa/VerifierPacks.tsx`, plus a compact summary tile in the IQA `ArchiveScreen`.

**Metrics** (aggregated from `verification_packs` + `audit_logs`):
- Total packs issued
- Active / expired / revoked counts
- Total downloads (sum of `download_count`)
- Unique verifiers that opened (distinct `verifier_id` from reviews, or user-agent hash from audit logs when anonymous)
- Days until next expiry
- "Remaining capacity" — soft budget per department (default 10 active packs, configurable in `system_settings`) with a progress bar so the archivist can throttle requests

Grouped by `department` with a filter (defaults to "All"). No new heavy queries — a small RPC `verification_pack_stats(_department text)` returns a single JSON row.

---

## 2. Pack composition rules

**Goal**: When generating a pack, IQA picks which document types are included; text-only-approved documents are auto-excluded when the doc-type policy has `forbid_text_only_fallback = true` (and can be manually excluded for other types).

**Schema** — extend `verification_packs`:
- `included_document_types text[]` (null = all types)
- `include_text_only_fallbacks boolean not null default true`

**UI** (`VerifierPacks.tsx` — "Create new pack" card):
- Multi-select of document types (pre-checked = all). Types whose policy `forbid_text_only_fallback = true` are shown with an "auto-excludes text-only" note.
- One switch: "Include text-only-approved documents". Disabled + forced OFF if every selected type has `forbid_text_only_fallback = true`.

**Enforcement** — `download-verification-pack` edge function:
- Filter `documents` query by `included_document_types` when present.
- When `include_text_only_fallbacks = false`, exclude documents whose `approval_mode = 'TEXT_ONLY'` (or where no stamped file exists). Manifest lists them under an "Excluded" section for transparency.

`create-verification-pack` accepts the two new fields and validates them.

---

## 3. Per-department verifier assignments

**Schema** — two new tables:

`verifiers`:
- `id`, `full_name`, `email` (unique), `organisation`, `phone`, `notes`, `created_by`, `created_at`, `updated_at`, `active boolean default true`

`verification_pack_assignees` (join):
- `id`, `pack_id → verification_packs`, `verifier_id → verifiers`, `assigned_at`, `assigned_by`, `email_sent_at`, `first_opened_at`

RLS: IQA / SUPER_ADMIN full access. GRANTs for `authenticated` + `service_role` only.

**UI**:
- New page `src/pages/iqa/Verifiers.tsx` — CRUD list of verifiers (name, email, org, active toggle).
- In `VerifierPacks.tsx`, each pack row gains an "Assign verifiers" button opening a modal that picks from the verifier list, filtered per department (verifiers can be tagged with departments via a text[] column `departments`). Shows who is currently assigned with a "Remove" action.
- The pack link presented to a verifier now includes `&v=<verifier_id>` so the `download-verification-pack` function can record `first_opened_at` and identify who is doing the review.

Nav entry "Verifiers" added for IQA + SUPER_ADMIN.

---

## 4. Verifier review workflow

**Goal**: When a verifier opens the pack, they can record per-document decisions.

**Schema** — new table `verifier_reviews`:
- `id`, `pack_id`, `document_id`, `verifier_id` (nullable — anon fallback), `decision` enum `('APPROVED','QUERY','REJECTED')`, `notes text`, `reviewed_at timestamptz default now()`
- Unique `(pack_id, document_id, verifier_id)`

RLS: IQA / SUPER_ADMIN read all. Inserts go via edge function only (service role). GRANT service_role all; GRANT authenticated select (for IQA read).

**Edge functions**:
- `verifier-session` — POST `{ token, verifier_id? }` returns a short-lived signed session cookie / JWT with `pack_id` + `verifier_id`; validates pack is active.
- `verifier-review-submit` — POST `{ session, document_id, decision, notes }` inserts / upserts a `verifier_reviews` row.
- Existing `download-verification-pack` unchanged; it just streams the ZIP.

**Public UI** — `src/pages/VerifyPack.tsx` upgraded:
- Instead of an immediate download, shows a landing page listing the pack's documents with a per-row `<select>` for decision + notes textarea and "Save review" button.
- "Download ZIP" button remains.
- Verifier identity chip if `&v=` is present.

**IQA view** — In `VerifierPacks.tsx` each pack expands to show a review summary: N/M documents reviewed, breakdown by decision, latest notes. Deep link to a read-only review detail page (`/iqa/packs/:id/reviews`).

---

## Files

**New**:
- `src/pages/iqa/Verifiers.tsx`
- `src/pages/iqa/PackReviews.tsx`
- `src/components/iqa/PackAnalyticsPanel.tsx`
- `src/components/iqa/AssignVerifiersModal.tsx`
- `supabase/functions/verifier-session/index.ts`
- `supabase/functions/verifier-review-submit/index.ts`
- `supabase/migrations/<ts>_verifier_reviews_and_assignments.sql`

**Edited**:
- `src/pages/iqa/VerifierPacks.tsx` (analytics + composition + assignment UI + review summary)
- `src/pages/VerifyPack.tsx` (verifier-facing review workflow)
- `src/pages/iqa/ArchiveScreen.tsx` (small analytics tile)
- `src/components/layout/BottomNav.tsx` (Verifiers nav entry)
- `src/App.tsx` (new routes)
- `supabase/functions/create-verification-pack/index.ts` (composition fields)
- `supabase/functions/download-verification-pack/index.ts` (composition filters + record first_opened_at)
- `supabase/config.toml` (new functions, `verify_jwt = false` for public ones)

---

## Notes

- All new tables scoped by RLS to IQA / SUPER_ADMIN via `has_role`.
- No `anon` grants anywhere — verifier flow is always service-role via edge function using the opaque token.
- Analytics uses a single `SECURITY DEFINER` SQL function returning JSON to keep the client query small.
- Order of implementation: (1) migration, (2) edge functions, (3) IQA screens, (4) public review UI.
