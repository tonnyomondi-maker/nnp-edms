## Plan

### 1. "Quick Approve" option for HOD & DP (text stamp instead of signature/stamp images)

Add a secondary approval path so approvers can skip the signature+stamp placement modal and instead burn a simple text label onto the PDF:
- **HOD**: `VERIFIED BY HOD — <Name> — <Date>`
- **DP**: `APPROVED BY DP ACADEMICS — <Name> — <Date>`

**Changes:**
- `supabase/functions/stamp-document/index.ts`: accept a new `mode: 'TEXT_ONLY'` body param. When set, skip image fetching and draw a bordered text block (top-right of last page by default, or at placement coords if provided). Still updates `signed_file_url`.
- `src/hooks/useDocuments.ts` (`performApproval` / `useUpdateDocumentStatus`): accept `mode?: 'IMAGE' | 'TEXT_ONLY'`. When `TEXT_ONLY`, do not require `signature_url`/`stamp_url` on the profile; pass `mode` to the edge function; skip writing the sig/stamp URL columns.
- `src/pages/hod/DepartmentQueue.tsx` and `src/pages/dp/ApprovalQueue.tsx`: add a second button **"Quick Verify"** (HOD) / **"Quick Approve"** (DP) next to the existing Approve button. It calls the mutation with `mode: 'TEXT_ONLY'` directly — no PlacementModal.
- Bulk approve in `BulkActionBar` flow: pass `mode: 'TEXT_ONLY'` (bulk already skips placement, so this is the natural fit — current bulk approve will fail for users without signature/stamp; switching bulk to TEXT_ONLY fixes that).

### 2. IQA early-download for once-per-term documents

Allow IQA to download a single once-per-term document (e.g. Scheme of Work, Course Outline — any `submission_type = 'ONCE_PER_TERM'`) at any stage, even before HOD verification or DP approval, **with a required reason**.

**Changes:**
- `src/pages/iqa/ArchiveScreen.tsx`: add a new tab/section **"Early Access"** listing all `ONCE_PER_TERM` documents regardless of status. Each row shows a **"Download with reason"** button that opens a dialog requiring a non-empty reason (min 10 chars), then:
  1. Inserts an `audit_logs` row with `action = 'IQA_EARLY_DOWNLOAD'`, `details = { reason, document_status, document_type, dpa_basis: 'Kenya DPA 2019 s.30(1)(b)(e)' }`.
  2. Fetches a signed URL for `file_url` (original) via `getCachedSignedUrl` and triggers browser download.
- No DB schema change — `audit_logs` already accepts arbitrary `action` + `details` and IQA can already SELECT/INSERT via existing policies. (Verify INSERT policy exists; if not, add a migration allowing authenticated INSERT on `audit_logs` — currently the table shows "Can't INSERT". This will need a small migration.)

### Migration (if needed)
Add INSERT policy on `public.audit_logs` for authenticated users so the client can log the early-download event:
```sql
CREATE POLICY "Authenticated can insert audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (performed_by = auth.uid());
GRANT INSERT ON public.audit_logs TO authenticated;
```

### Files to touch
- `supabase/functions/stamp-document/index.ts` — add text-only rendering branch
- `src/hooks/useDocuments.ts` — thread `mode` through approval
- `src/pages/hod/DepartmentQueue.tsx` — Quick Verify button
- `src/pages/dp/ApprovalQueue.tsx` — Quick Approve button
- `src/pages/iqa/ArchiveScreen.tsx` — Early Access tab + reason dialog
- New migration for `audit_logs` INSERT policy

### Out of scope
- No change to IQA archive flow itself (still requires sig+stamp placement)
- No change to rejection flow
- No change to existing image-based approval (remains the default high-fidelity option)
