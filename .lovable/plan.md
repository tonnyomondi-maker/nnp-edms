

## Plan: Bulk Export & Archive Approved Documents as ZIP

### Goal
Let admins (DP Academics / IQA) export all archived (fully-approved) documents for a chosen training session as a single ZIP file, with an option to delete the originals from cloud storage afterwards to free up space.

### Concept

Training sessions = three terms per year:
- **Jan–Apr** (Term 1)
- **May–Aug** (Term 2)
- **Sep–Dec** (Term 3)

Sessions are derived from each document's `archived_at` date (year + month bucket). The export packages every `ARCHIVED` document in that session into a ZIP, organized by department / trainer / file, plus a manifest CSV with the audit metadata.

### 1. New Edge Function: `export-session-zip`

Path: `supabase/functions/export-session-zip/index.ts`

- Accepts `{ year: number, session: 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC', deleteAfter?: boolean }`
- Auth: requires JWT; checks caller has `IQA` or `DP_ACADEMICS` role via `has_role` RPC
- Queries `documents` where `status = 'ARCHIVED'` and `archived_at` falls in the session window, joins `teaching_assignments` and `profiles` for trainer info
- Downloads each `signed_file_url` (or `file_url` fallback) from the `documents` storage bucket using service role
- Builds a ZIP using a Deno-compatible library (`jsr:@zip-js/zip-js` or `https://deno.land/x/zipjs`) with structure:
  ```text
  /<Department>/<Trainer Name>/<unit_code>_<doc_type>_w<week>.pdf
  /manifest.csv      ← id, dept, trainer, unit, type, week, archived_at, approvers
  /README.txt        ← session label + export timestamp + counts
  ```
- If `deleteAfter = true`: after successful zip generation, deletes the original storage objects (`signed_file_url` + `file_url`) and updates each row to `status = 'EXPORTED'` with `exported_at` timestamp (keeping the DB record for audit)
- Returns the ZIP as a streamed binary download

### 2. Database Changes

Migration:
- Add `'EXPORTED'` to the `document_status` enum
- Add `exported_at TIMESTAMPTZ` and `exported_by UUID` columns to `documents`
- Add RLS update policy so IQA/DP can mark documents as exported (already covered by existing update policies — just confirm)

### 3. New Page: Session Exports

Path: `src/pages/admin/SessionExports.tsx`, route `/admin/exports`

- Visible to `IQA` and `DP_ACADEMICS` roles
- UI:
  - Year selector (current year ± 2)
  - Three session cards (Jan–Apr, May–Aug, Sep–Dec) each showing count of archived docs in that bucket
  - "Download ZIP" button per session
  - "Download ZIP & free storage" button (with confirm dialog explaining originals will be deleted but DB records kept for audit)
  - History list of previous exports (docs with `status = 'EXPORTED'`) grouped by session
- Calls the edge function via `supabase.functions.invoke('export-session-zip', { body, responseType: 'blob' })` and triggers browser download

### 4. Navigation

- Add link in `src/components/layout/AppShell.tsx` / `BottomNav.tsx` sidebar for IQA/DP roles → "Session Exports"

### Files

**Create**
- `supabase/functions/export-session-zip/index.ts`
- `src/pages/admin/SessionExports.tsx`
- Migration: enum value + `exported_at` / `exported_by` columns

**Modify**
- `src/App.tsx` — add `/admin/exports` route
- `src/components/layout/AppShell.tsx` (or wherever nav lives) — add nav item

### Open question

Should "free storage" mode also delete the **original unsigned** PDF (`file_url`), or only the signed/stamped one? My default: delete both, since the signed PDF is the official archived version inside the ZIP and the unsigned original is no longer needed once exported.

