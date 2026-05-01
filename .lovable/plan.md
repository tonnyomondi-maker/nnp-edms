

The user is clarifying terminology:
- **Session** = the calendar window (Jan–Apr, May–Aug, Sep–Dec) — this stays as-is.
- **Term** (Term 1 / 2 / 3) is NOT the same as session. Term depends on the **trainee intake** (when a cohort started) and is set per unit/course, not per calendar.

So the current code that labels sessions as "Term 1 — January–April" is wrong. Term should be decoupled from session and entered by the trainer when configuring a unit.

## Plan: Decouple Term from Session

### Concept
- **Session** stays the calendar bucket: `JAN_APR`, `MAY_AUG`, `SEP_DEC`. Label it by months only, e.g. "January – April 2026". No "Term 1/2/3" attached.
- **Term** becomes a per-unit attribute (1, 2, or 3) that the trainer sets when they first configure the unit for a session — it reflects which term that intake is in.

### Database
Migration on `unit_session_config`: add `term_number INT` (1–3, nullable for legacy rows).
Migration on `documents`: add `term_number INT` (denormalized, copied from config at submit time so HOD/DP/IQA queues and exports can filter by term).

### Code changes

**`src/lib/sessions.ts`**
- Remove `Term 1/2/3` from `SESSION_TERMS` labels. Change to just months: "January – April", "May – August", "September – December".
- `sessionLabel(year, term)` returns e.g. "January – April 2026" (no "Term 1 —" prefix).

**`src/pages/trainer/UploadDocuments.tsx`**
- Add a "Term" selector (1 / 2 / 3) in the unit-config section, alongside `sessions_per_week`. Persist to `unit_session_config.term_number`.
- Include `term_number` in each document insert.

**`src/hooks/useUnitSessionConfig.ts`**
- Add `term_number` to upsert payload + row type.

**`src/hooks/useDocuments.ts`**
- `useSubmitDocument` accepts and writes `term_number`.

**`src/pages/trainer/MyTeaching.tsx`**
- Show "Term {n}" badge on each unit card (from config).
- Session dropdown uses new month-only labels.

**`src/components/common/DocumentCard.tsx`**
- Show "Term {n}" next to unit info when present.

**`src/pages/admin/SessionExports.tsx`**
- Card titles use month-only labels. Optional secondary filter "Filter by term" (1/2/3) on each session card.

**`supabase/functions/export-session-zip/index.ts`**
- README.txt header uses month-only label. Manifest gets a `term_number` column. ZIP folder structure stays department/trainer based (no change).

### Files
- **Modify**: `src/lib/sessions.ts`, `src/pages/trainer/UploadDocuments.tsx`, `src/hooks/useUnitSessionConfig.ts`, `src/hooks/useDocuments.ts`, `src/pages/trainer/MyTeaching.tsx`, `src/components/common/DocumentCard.tsx`, `src/pages/admin/SessionExports.tsx`, `supabase/functions/export-session-zip/index.ts`
- **Migration**: add `term_number` to `unit_session_config` and `documents`

