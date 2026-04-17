## Plan: Signature & Stamp on Approval (with Bulk Actions)

### Concept

When HOD, DP Academics, or IQA approve a document, their digital **signature** and **stamp** images get applied to the document record. To avoid uploading them every approval, each approver uploads their signature + stamp **once** in profile settings, and the system auto-applies them on approval. Bulk approval lets them tick multiple documents and approve all at once with their saved signature/stamp.

### 1. Database Changes

**Migration** — extend `profiles` and `documents`:

- `profiles`: add `signature_url TEXT`, `stamp_url TEXT` (nullable)
- `documents`: add columns to track who signed/stamped at each stage:
  - `hod_signature_url TEXT`, `hod_stamp_url TEXT`, `hod_approved_by UUID`
  - `dp_signature_url TEXT`, `dp_stamp_url TEXT`, `dp_approved_by UUID`
  - `iqa_signature_url TEXT`, `iqa_stamp_url TEXT`, `iqa_archived_by UUID`

**Storage** — new public bucket `signatures` (separate from private `documents` bucket since approvers' marks need to be readable by anyone viewing the document later). RLS:

- Anyone authenticated can read
- Users can only upload/update files under `{user_id}/...`

### 2. Profile Settings — Upload Signature & Stamp

Extend `src/pages/ProfileSettings.tsx`:

- Two new file upload fields: **Signature** (PNG/JPG, transparent bg recommended) and **Stamp** (PNG/JPG)
- Show current image preview if uploaded
- Upload to `signatures/{user_id}/signature.png` and `signatures/{user_id}/stamp.png`
- Save resulting public URLs to `profiles.signature_url` / `profiles.stamp_url`
- Only shown for users with HOD, DP_ACADEMICS, or IQA roles (trainers don't approve)

### 3. Approval Flow — Auto-apply Signature/Stamp

Update `useUpdateDocumentStatus` hook in `src/hooks/useDocuments.ts`:

- Before updating, fetch current user's `profiles.signature_url` and `stamp_url`
- If user is approving (HOD_APPROVED / DP_APPROVED / ARCHIVED), require both to be set — else throw a friendly error ("Please upload your signature and stamp in Profile Settings first")
- Write the URLs into the appropriate stage columns on the document along with the status change

### 4. Bulk Approval UI

Update three approval pages — `src/pages/hod/DepartmentQueue.tsx`, `src/pages/dp/ApprovalQueue.tsx`, `src/pages/iqa/ArchiveScreen.tsx`:

- Add a checkbox to each `DocumentCard` (new optional `selectable` + `selected` + `onSelectChange` props)
- Add a sticky action bar at the top showing **"N selected"** with **"Approve All"** and **"Reject All"** buttons (Reject opens a small dialog for a shared reason)
- Add **"Select All"** / **"Clear"** toggle
- New bulk mutation in `useDocuments.ts`: `useBulkUpdateDocumentStatus` that loops the approval mutation across selected ids in parallel, surfaces a single toast with success/failure counts

### 5. Document Card Display

Update `src/components/common/DocumentCard.tsx`:

- When a document has signature/stamp URLs filled in for any stage, show small thumbnail icons next to the status badge (hover/tap → larger preview) so trainers and downstream approvers can see the chain of approvals visually

### Files

**Create**

- Migration adding profile + document columns and `signatures` bucket with RLS

**Modify**

- `src/pages/ProfileSettings.tsx` — signature/stamp upload section
- `src/hooks/useDocuments.ts` — enrich approval mutation, add bulk mutation
- `src/pages/hod/DepartmentQueue.tsx`, `src/pages/dp/ApprovalQueue.tsx`, `src/pages/iqa/ArchiveScreen.tsx` — selection state + bulk action bar
- `src/components/common/DocumentCard.tsx` — selectable prop + signature/stamp thumbnails

### Open Questions

1. **Stamp/signature requirement**: Should approval be **blocked** if the approver hasn't uploaded their signature & stamp yet, or should it just proceed without them? (I assumed blocked — safer for audit trail.)-BLOCKED
2. **Visual application**: Currently signatures/stamps are stored against the document **record**, not burned into the PDF itself. PDF compositing (drawing the signature onto the actual PDF) would need an Edge Function with a PDF library — bigger scope. OK to defer that and just display them in the app UI for now? BURN THEM INTO THE PDF
3. &nbsp;