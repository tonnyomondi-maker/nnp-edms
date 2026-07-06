## Goal

Three related changes: (1) tighten the Google Drive retry button to IQA-only with bulk retry per department, (2) add a per-doc-type toggle to forbid text-only approval fallback, (3) let IQA and Super Admin generate a shareable verification pack per department for external verifiers.

---

## 1. Retry Drive sync — IQA only, per document + bulk

**Component change** (`src/components/common/RetryDriveSyncButton.tsx`)
- Hide the button entirely unless `syncStatus === 'failed'` AND active role is `IQA` (or `SUPER_ADMIN`).
- If `syncStatus === 'success'`, render nothing (previously showed "Open in Drive" — move that link into `DocumentCard` details instead so it's still reachable).

**New bulk action** (`src/pages/iqa/ArchiveScreen.tsx`)
- Add a "Retry failed Drive syncs" button in the department filter bar. Disabled when active role ≠ IQA/SUPER_ADMIN.
- Queries `documents` where `gdrive_sync_status = 'failed'` and `department = <selected>`; invokes `gdrive-upload` for each with concurrency of 3; shows a progress toast with succeeded/failed counts.
- Guarded via existing `ActionGuardButton` pattern.

---

## 2. Forbid text-only fallback toggle

**Schema** — add column to `document_type_policy`:
- `forbid_text_only_fallback boolean not null default false`

**Enforcement**
- `src/hooks/useDocuments.ts` `performApproval`: when `mode === 'TEXT_ONLY'` and `policy.forbid_text_only_fallback`, throw `"Text-only approval is disabled for this document type — a signature or stamp image is required."` (in addition to the existing stamp_required check).
- `supabase/functions/stamp-document/index.ts`: same server-side guard as defence in depth.

**UI** (`src/pages/admin/ApprovalPolicies.tsx`)
- Add a third switch per row: **"Forbid text-only fallback"** with helper "Approver must have an uploaded signature or stamp — no plain-text approval block."
- Persist through the existing `saveRow` upsert.

---

## 3. Verifier presentation pack per department (IQA + Super Admin)

**Goal**: IQA/Super Admin picks a department + academic session; the system produces a **shareable link** that lets an external verifier download a ZIP of that department's `ARCHIVED` documents plus an index PDF (cover sheet listing doc type, unit, trainer, approval dates, verification URL).

**Schema** — new table `verification_packs`:
- `id`, `department`, `session_year`, `session_term`
- `token` (opaque, random, unique) — used in the shareable URL
- `expires_at` (default now() + 30 days), `revoked_at`
- `created_by`, `created_at`, `download_count`
- RLS: only IQA/SUPER_ADMIN can insert/select/update; anon can select only by token (via edge function, not client).
- GRANTs: `authenticated` full, `service_role` all. No `anon` grant — access is only through the edge function using service role.

**Edge functions**
- `create-verification-pack` (JWT-verified, IQA/SUPER_ADMIN only): validates dept+session, inserts row, returns `{ token, url }`.
- `download-verification-pack` (public, token in query): looks up token, checks `expires_at`/`revoked_at`, streams a ZIP of archived docs for that dept+session with an auto-generated cover PDF, increments `download_count`, logs to `audit_logs`.

**UI**
- New page `src/pages/iqa/VerifierPacks.tsx` (also linked from Super Admin nav):
  - Department + session pickers, "Generate link" button.
  - Table of existing packs with: link (copy), expiry, download count, "Revoke" action.
- Add route in `App.tsx`, nav entry via existing role-gated nav config.

---

## Technical notes

- Bulk retry uses a small async pool (3) instead of `Promise.all` to avoid hammering the edge function.
- Verification link format: `https://<app>/verify/pack?token=<opaque>` → maps to a lightweight public page that calls `download-verification-pack` and triggers the download; no auth required, no data exposed beyond that pack.
- Cover PDF is generated in the edge function with `pdf-lib` (already used by `stamp-document`).
- Existing `VerifyDocument` per-file page is unchanged; the pack is a separate department-level artefact.

---

## Files touched

**New**: `supabase/migrations/<ts>_verification_packs_and_policy.sql`, `supabase/functions/create-verification-pack/index.ts`, `supabase/functions/download-verification-pack/index.ts`, `src/pages/iqa/VerifierPacks.tsx`, `src/pages/VerifyPack.tsx` (public landing).

**Edited**: `src/components/common/RetryDriveSyncButton.tsx`, `src/components/common/DocumentCard.tsx` (move "Open in Drive" link out), `src/pages/iqa/ArchiveScreen.tsx` (bulk retry button), `src/pages/admin/ApprovalPolicies.tsx` (third switch), `src/hooks/useDocuments.ts` (text-only guard), `src/hooks/useDocTypePolicy.ts` (new field in type), `supabase/functions/stamp-document/index.ts` (server-side guard), `src/App.tsx` (routes), nav config.
