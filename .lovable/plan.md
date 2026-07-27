## Scope

Five concrete fixes across dashboards, admin controls, signature previews, and verifier packs. Trainer/HOD/DP/IQA/Super Admin each get a role-aware dashboard fed by real database data. The signature bucket is private, which is why previews and Sign-and-Approve embeddings looked "broken"; we switch to signed URLs. Verifier packs currently only pull `status = 'ARCHIVED'` docs and don't tell the IQA when there are none — we surface a live preview count while composing the pack, relax the query to include DP-approved docs, and nest per-trainer inside pack ZIPs.

## 1. Role dashboards backed by real data

- `src/pages/Dashboard.tsx` today only shows the caller's own documents. Extend it so each role sees the metrics that matter to them, all queried live from the DB (no mock data):
  - **TRAINER** — keep existing "my docs" cards; add SLA badge per pending doc using `sla_targets`.
  - **HOD** — pending in my department, avg time-to-approve last 30d, top 5 trainers by pending count. (Data via `documents` filtered by `department = my department`.)
  - **DP_ACADEMICS** — pending across departments (bucket by dept), oldest waiting doc, breaches vs `sla_targets`.
  - **IQA** — DP-approved awaiting archival (per dept), active packs (`verification_packs` not revoked / not expired), downloads last 7d.
  - **SUPER_ADMIN** — global counts by status, users by role, storage tier split (cloud vs drive), last backup timestamp from `backup_metadata`, last reset from `audit_logs.action='SYSTEM_RESET'`.
- Reuse the existing `useAcademicSession`, `verification_pack_stats_by_dept` RPC, and `sla_targets` reads — no new tables.

## 2. Make "Reset system" reachable from admin dashboard

- `SystemResetCard` already exists on `/admin/setup`. Add a compact copy of it (or a link + confirm modal) to the new Super Admin dashboard section so a Super Admin can trigger a full reset without hunting through the menu. No changes to the `system-reset` edge function.

## 3. Signature & stamp preview fix (bucket is private)

Root cause: `ProfileSettings.persistAsset` calls `supabase.storage.from('signatures').getPublicUrl(...)`. That bucket was made private in an earlier security pass, so the returned URL 403s and the `<img>` preview stays blank. The same URL is stored on `profiles.signature_url` / `profiles.stamp_url` and later handed to the `stamp-document` edge function.

Changes:
- `src/pages/ProfileSettings.tsx` — store only the **storage path** (e.g. `<userId>/signature.png`) in `profiles.signature_url` / `stamp_url`, and generate a fresh **signed URL** (1h) for the on-page `<img>` preview via `supabase.storage.from('signatures').createSignedUrl(path, 3600)`.
- Add a small `useSignedSignature(path)` helper (`src/hooks/useSignedDocUrl.ts` already has the pattern) to reuse the signing logic wherever a signature image is displayed (approval dialogs, verifier UI).
- `supabase/functions/stamp-document/index.ts` — the earlier fix already switched to service-role `downloadFromStorage(parseStorageRef(url))`, which accepts both full URLs and bare paths, so bare paths keep working. Add a defensive branch to also accept legacy public-URL rows.
- No schema migration; the column already holds `text`.

## 4. IQA can't generate packs / packs are empty

Two separate problems:

**a) "Cannot generate" toast** — `create-verification-pack` succeeds only for `IQA` or `SUPER_ADMIN` and requires `department`, `session_year`, and a valid `session_term`. The UI silently no-ops when department is blank. We'll:
- In `VerifierPacks.tsx`, disable the "Generate" button until dept/year/term are all set and show inline validation instead of only a toast.
- Surface the raw `error.message` from `supabase.functions.invoke` (currently swallowed when the invoke throws before returning JSON).

**b) "Pack has no documents"** — `download-verification-pack` filters by `status='ARCHIVED'`. If the IQA hasn't archived yet, the ZIP is empty and the meta endpoint reports `document_count: 0`. Fix by:
- Adding an **eligible-documents preview** to `VerifierPacks.tsx` shown before generation: live `SELECT count` grouped by document_type for the chosen dept/year/term where `status='ARCHIVED'`. If the count is 0, show a "No archived documents match — archive DP-approved docs first" hint with a link to `/iqa/archive`.
- Adding an optional pack setting **"Include DP-approved (not yet archived)"** stored as `include_dp_approved boolean default false` on `verification_packs`. When set, `download-verification-pack` widens the status filter to `IN ('DP_APPROVED','ARCHIVED')`. This lets an IQA share a pack for external review before finalising archival.

## 5. Per-department, per-trainer nested ZIPs (packs + session export)

- `export-session-zip` already supports `department`, `trainerId`, and `nested: true`; `SessionExports.tsx` already passes `nested: true`. Make the file layout inside the ZIP explicit and consistent: `<Department>/<Trainer Full Name (PF#)>/<UnitCode>_<DocumentType>_<shortId>.pdf` plus a root `INDEX.csv`.
- `download-verification-pack` currently flattens all PDFs to the root. Change it to the same nested layout: `<Department>/<Trainer Full Name>/<file>.pdf`, keep `INDEX.txt`, and add a per-trainer count section.

## Files touched

```text
src/pages/Dashboard.tsx                         (role-aware widgets, real queries)
src/components/admin/SuperAdminDashboardBlock.tsx (new) — reset shortcut + system stats
src/pages/ProfileSettings.tsx                    (store path, sign for preview)
src/hooks/useSignedSignature.ts                  (new tiny helper)
src/pages/iqa/VerifierPacks.tsx                  (validation, eligibility preview, DP toggle)
supabase/functions/create-verification-pack/index.ts (accept include_dp_approved)
supabase/functions/download-verification-pack/index.ts (per-trainer nesting, DP status)
supabase/functions/export-session-zip/index.ts   (explicit nested path + INDEX.csv rows)
```

## Migration

One migration only — for the new pack option:

```text
ALTER TABLE public.verification_packs
  ADD COLUMN include_dp_approved boolean NOT NULL DEFAULT false;
```

No RLS/GRANT change required (existing policies already cover the column).

## Verification

- Sign in as each role; confirm the Dashboard shows real numbers (trainer=my docs, HOD=dept queue, DP=cross-dept queue, IQA=archive queue + active packs, Super Admin=global + last reset/backup + Reset button that opens the existing confirm flow).
- Upload a signature; confirm the preview renders immediately (signed URL) and Sign-and-Approve still stamps the PDF.
- As IQA, pick a dept/session with no archived docs → see the "0 eligible" hint. Archive one doc, refresh → count moves to 1. Generate the pack, open the shared link, confirm the ZIP has `Department/Trainer/file.pdf` structure.
- Toggle "Include DP-approved" on a session that has DP_APPROVED but no ARCHIVED → pack downloads with those PDFs.
- Run a Session Export with dept + trainer filters → confirm nested layout and INDEX.csv.
