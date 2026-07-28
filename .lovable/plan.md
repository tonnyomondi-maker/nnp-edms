## What's broken and why

1. **Placement modal shows no signature/stamp preview** — `ProfileSettings` now saves bare storage paths (e.g. `<uid>/signature.png`) into `profiles.signature_url` / `stamp_url`. Confirmed via DB: two of three profiles hold bare paths. `DepartmentQueue`, `ApprovalQueue` and `ArchiveScreen` fetch those values and pass them straight into `PlacementModal` as `sigUrl` / `stampUrl`, which renders them inside `<img src>`. A bare path is not a URL, so the images 404 and the drag boxes show empty — you can't size or set opacity because you can't see them.
2. **HOD Sign & Approve / IQA Archive return non‑2xx** — same root cause on the server side is likely, but to be certain the plan's first step is to reproduce and read the actual error surfaced in the toast (already forwarded by `useDocuments` from the edge function body). Most probable causes given current state:
  - `stamp-document` receives a bare-path signature but `fetchImageAsset`'s SSRF guard runs before the "bare path" branch — need to confirm that path (it should already fall through, but IQA archive path also stamps and could be tripping the storage RLS on writing `stamped_IQA_*.pdf` after the `can_stamp_document_file` tightening).
  - Or the "documents" bucket storage-write policy for IQA/stamped prefix is rejecting the upload since the last security hardening.
   Verification is step 1; the fix depends on which of the two it turns out to be.
  - from term/module then the groupings should be per department then per trainer and also give an option to group per documents for the entire term for iqa, dp academics and super admins in case it is wanted per document e.g lesson plans for the entire school etc
3. **IQA archive has no per‑department / per‑trainer bulk download** — `download-verification-pack` already nests by dept/trainer, but the Archive screen only offers per-doc downloads. Need a "Download archived (ZIP)" action that calls `export-session-zip` with `nested: true`, scoped to the current department + stage filter.
4. **DP → IQA → Super Admin queues aren't grouped by module** — `TermFilter` filters *one* term/module at a time but never *groups*. From DP onwards these roles look across the whole institution and need to see documents clustered per module (M1..M10) and per term (T1..T3), with headers and counts.

## Plan

### Step 1 — Reproduce & confirm the 2xx failure (before editing)

- Have you click HOD Sign & Approve once so the edge function actually runs, then read `stamp-document` logs to get the exact server error. This decides whether the fix is (a) signature fetch, (b) storage upload policy, or (c) something else. Only after the log is read will Step 2 be finalised; the rest of the plan below is independent of that outcome and will go ahead either way.

### Step 2 — Fix signature/stamp preview in placement modal

- Add a small helper `resolveSignatureUrl(pathOrUrl)` (in `src/hooks/useSignedDocUrl.ts` alongside the existing helpers) that:
  - Returns full `http(s)` URLs unchanged (legacy public URLs).
  - Otherwise calls `supabase.storage.from('signatures').createSignedUrl(path, 3600)`.
- Update the three approve/archive callers (`DepartmentQueue.handleApprove`, `ApprovalQueue.handleApprove`, `ArchiveScreen.handleArchive`) to resolve both signature and stamp values through this helper before setting `placementDoc`, so `PlacementModal` always receives real image URLs and the drag boxes show the actual signature/stamp for sizing, rotation and opacity.
- Add a small `onError` handler on the `<img>` elements inside `PlacementModal` that logs the failure to console — cheap safety net for future path drift.

### Step 3 — Fix the stamp-document 2xx failure

Based on Step 1's log message, apply the smallest matching fix:

- **If it's an SSRF/URL parse error**: reorder `fetchImageAsset` in `supabase/functions/stamp-document/index.ts` to treat non-URL values as `signatures`-bucket paths *before* running the SSRF check, and delete the now-unreachable URL branch for bare paths.
- **If it's a storage RLS write rejection** on `stamped_IQA_*.pdf` / `stamped_HOD_*.pdf`: extend `can_stamp_document_file` to also match the IQA stage against `DP_APPROVED` docs (already there — re-verify) and, if needed, add/adjust the storage.objects INSERT policy so the service role's stamped-write path validates cleanly. The migration will re-run the four-step (`CREATE`/`GRANT`/`ENABLE RLS`/`CREATE POLICY`) pattern only if a new policy is required.
- **If it's a policy check failure** ("Policy requires an embedded stamp"): the actual bug is elsewhere (missing stamp for that role); surface a clearer toast rather than change the policy.

Deploy the edge function change; verify by re-running HOD Sign & Approve and IQA Archive against a test document.

### Step 4 — IQA archive bulk download nested per department & per trainer

- In `src/pages/iqa/ArchiveScreen.tsx`, add a "Download archived ZIP" button in the Archived tab header. It calls `supabase.functions.invoke('export-session-zip', { body: { nested: true, status: 'ARCHIVED', department: <deptFilter>, session_year, session_term, term_number|module_number } })`, using the current `TermFilter` + `deptFilter` values. Wire it through `ActionGuardButton` with the `export` action so trainers/HOD can't see it.
- Show progress via the existing `ExportProgressPanel` pattern (or a lightweight inline toast + spinner).
- The ZIP layout produced by `export-session-zip` already follows `Department/<Trainer PF> - <Name>/<Doc>.pdf`, matching the verification pack layout — no server changes.

### Step 5 — Group DP / IQA / Super Admin views by module/term

- Add a small utility `groupByStage(docs)` to `src/components/common/TermFilter.tsx` that returns `[{ key: 'T1'|'M2'|…, label, docs }]` sorted with terms first then modules ascending.
- In `ApprovalQueue.tsx` (DP), `ArchiveScreen.tsx` (IQA — both "To Archive" and "Archived" tabs) and Super Admin document listings (`RoleDashboardBlocks.SuperAdminBlock` or any admin doc-list surface it renders), render each group under a sticky header showing `Module 3 — 12 documents` / `Term 2 — 8 documents`, with the group collapsible (default expanded). When `TermFilter` is set to a specific stage, there is only one group; when it's `ALL`, the grouping is the primary organiser.
- Keep the existing `TermFilter` dropdown so users can still drill to a single stage.

### Step 6 — Verify end‑to‑end

- HOD Sign & Approve: signature + stamp appear inside the drag boxes, sliders resize/opacity work, Confirm places them and returns success.
- DP Sign & Approve: same.
- IQA Archive: same, and status flips to ARCHIVED.
- IQA "Download archived ZIP": ZIP unpacks to `Dept/Trainer/*.pdf` mirroring verification pack layout.
- DP / IQA / Super Admin document lists show module and term headers with per-group counts.

## Notes for the technical reviewer

- No schema change is expected. The only migration is a conditional one under Step 3 if the log points at a storage policy — will be a single migration following the four-step (CREATE / GRANT / ENABLE RLS / CREATE POLICY) rule.
- `PlacementModal` itself doesn't need to change beyond an image `onError` log — resolving to signed URLs is the caller's responsibility so the modal stays presentational.
- `export-session-zip` already supports nested layout and filtered downloads; no function edits needed for Step 4.