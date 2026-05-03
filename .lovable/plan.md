## Plan: Course Type, Module/Term, Course Outline, HOD Fix

### 1. Updated Department List

Replace `DEPARTMENTS` in `src/lib/sessions.ts` with the official 8:

- Computing & Informatics
- Building & Civil Engineering
- Mechanical Engineering
- Electrical & Electronic Engineering
- Agriculture & Environment
- Fashion & Cosmetology
- Business & Entrepreneurship
- Hospitality & Tourism

(Removes "Liberal Studies", "Applied Sciences", renames "Electronics" → "Electronic", "Hospitality & Institutional Management" → "Hospitality & Tourism", "Agriculture" → "Agriculture & Environment", "Business Studies" → "Business & Entrepreneurship".)

Also fix HOD test account — update `hod@test.com` profile department from "Computer Science" to **"Computing & Informatics"** so it matches uploaded documents (this is why approvals don't show).

### 2. Course Type: Modular vs Cycle

Add a **Course Type** selector during unit setup (on `UploadDocuments.tsx`):

- **Cycle 1 / Cycle 2** (existing flow) → keeps **Term 1/2/3** dropdown
- **Modular** → swaps Term dropdown for **Module 1 … Module 8** dropdown

DB changes (new migration on `unit_session_config` and `documents`):

```sql
ALTER TABLE unit_session_config
  ADD COLUMN course_type text,           -- 'CYCLE' | 'MODULAR'
  ADD COLUMN module_number integer;      -- 1..8 when MODULAR

ALTER TABLE documents
  ADD COLUMN course_type text,
  ADD COLUMN module_number integer;
```

`term_number` stays for cycle courses; `module_number` populated for modular. Validation trigger (not CHECK) ensures exactly one of `term_number` / `module_number` is set per course_type.

### 3. Course Outline as One-Time Document

Add `'Course Outline'` to `ONE_TIME_DOC_TYPES` in `src/lib/sessions.ts`. The `document_type` column on `documents` is a USER-DEFINED enum — needs migration:

```sql
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'Course Outline';
```

### 4. Fix HOD "Cannot Approve" — Department Scoping

Two issues:

a) **Data mismatch** (above) — fix HOD profile department.

b) **RLS too broad** — current policies let HOD see all docs, not just their dept. Tighten:

```sql
DROP POLICY "HOD can view department documents" ON documents;
CREATE POLICY "HOD can view own department documents"
  ON documents FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'HOD')
    AND department = (SELECT department FROM profiles WHERE user_id = auth.uid())
  );

DROP POLICY "HOD can update document status" ON documents;
CREATE POLICY "HOD can update own department documents"
  ON documents FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'HOD')
    AND department = (SELECT department FROM profiles WHERE user_id = auth.uid())
  );
```

(DP & IQA policies remain global — they are cross-department roles.)

### 5. Trainer Self-Assigns on Upload (already true — confirm)

Current upload flow already lets trainers freely type unit code, name, class, department without an existing assignment. No change needed beyond confirming `assignment_id` stays nullable. Document this in UI helper text under unit code: *"Type any unit you teach — no pre-assignment needed."*

### 6. UI Updates

**`UploadDocuments.tsx`**:
- Add Course Type select (Cycle 1 / Cycle 2 / Modular)
- Conditional: Modular → Module dropdown (1–8); Cycle 1/2 → Term dropdown (existing)
- Pass `course_type`, `module_number` through `useUpsertUnitConfig` & `useSubmitDocument`

**`useDocuments.ts` / `useUnitSessionConfig.ts`**: extend payload types with `course_type` and `module_number`.

**`DocumentCard.tsx`**: show "Module N" badge when modular, else "Term N".

**`TermFilter.tsx`** → rename to `StageFilter.tsx` (or keep + add ModuleFilter):
- For modular docs, filter by Module 1–8
- Show two filters when mixed; or auto-detect dominant course type

**HOD/DP/IQA queues**: include both filters; default to dominant stage.

### 7. Files Modified

- `src/lib/sessions.ts` — departments, ONE_TIME_DOC_TYPES (+Course Outline), course type constants
- `src/pages/trainer/UploadDocuments.tsx` — course type + module/term UI
- `src/hooks/useUnitSessionConfig.ts` — new fields
- `src/hooks/useDocuments.ts` — new fields
- `src/components/common/DocumentCard.tsx` — module badge
- `src/components/common/TermFilter.tsx` → extend with module filter
- `src/pages/hod/DepartmentQueue.tsx`, `src/pages/dp/ApprovalQueue.tsx`, `src/pages/iqa/ArchiveScreen.tsx` — wire module filter
- `src/integrations/supabase/types.ts` — auto-regen
- New migration: enum value, columns, RLS rewrite, HOD profile dept fix
