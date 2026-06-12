## 1. Admin "System Reset" entry point

The backend already exists: `supabase/functions/system-reset/index.ts` (Super-Admin only, requires `RESET YYYY-MM-DD` confirmation, engages safety lock, wipes storage + data tables, leaves profiles/roles/system_settings intact, writes a `SYSTEM_RESET` audit row). It's currently surfaced inside `admin/SystemBackups.tsx` only.

Add a dedicated, more discoverable **System Reset** card on `admin/SystemSetup.tsx`:

- Red-bordered destructive card visible only to active Super Admin.
- Shows the same `RESET <today>` confirmation input + a typed checkbox ("I understand this wipes all documents and audit history").
- Calls the existing `system-reset` function via `supabase.functions.invoke`.
- Disables itself when the safety lock is already engaged by another admin.
- Shows last-reset timestamp pulled from `audit_logs` (action=`SYSTEM_RESET`).

No new edge function, no schema change.

## 2. Extend `ActionGuardButton` coverage to export / report actions

Add a new `DocAction` value `'export'` already exists in `useRoleGuard.ts` but currently returns `true` for everyone. Refine:

- `'export'` allowed for: active TRAINER (own scope), HOD, DP_ACADEMICS, IQA, SUPER_ADMIN. Not blocked by lock.
- `'reset'` (new) allowed only for active SUPER_ADMIN, **blocked when lock is on unless caller is the locker**.

Wrap the following buttons in `ActionGuardButton`:

- `pages/Reports.tsx` — "Export CSV" / "Export PDF" buttons.
- `pages/admin/SessionExports.tsx` — "Export ZIP" and "Export & free storage" buttons.
- `pages/trainer/MySubmissions.tsx` — per-row "Download" / "Export" buttons.
- `pages/admin/SystemBackups.tsx` — existing reset button (move/share with new SystemSetup card via shared component).
- `pages/admin/ManageUsers.tsx` — Delete user button (action=`'delete'`, already exists).

Tooltip copy comes from `useRoleGuard.reasonFor`, with new strings for `'export'` and `'reset'`.

## 3. Per-document-type signature-only policy

Today `profiles.stamp_required` is a single per-approver boolean. Replace with a per-document-type map so admins can say "Weekly Class Attendance can be signature-only, One-time Course Outline requires a stamp."

**Schema (migration)**

New table:

```text
public.document_type_policy
  document_type            document_type PRIMARY KEY
  signature_only_allowed   boolean   NOT NULL DEFAULT false
  stamp_required           boolean   NOT NULL DEFAULT true
  notes                    text
  updated_by               uuid
  updated_at               timestamptz
```

- GRANT SELECT to authenticated, ALL to service_role.
- RLS: SELECT to authenticated; INSERT/UPDATE/DELETE only to SUPER_ADMIN via `has_role`.
- Seed defaults: WEEKLY-submission types (`Class Attendance`, `Session Plan`) → `signature_only_allowed = true, stamp_required = false`. ONE_TIME types (`Learning Plan`, `Personal Timetable`, `Workload Allocation`, `Scheme of Work`, `Course Outline`) → `stamp_required = true`.

**Admin UI**

- New page `pages/admin/ApprovalPolicies.tsx` (linked from `SystemSetup`). Table of document types with two toggles per row: "Allow signature-only" and "Stamp required". Super-Admin only, wrapped in `ActionGuardButton`.

**Approval flow integration**

- `useDocuments.performApproval`: before validating `signature_url` / `stamp_url`, fetch the policy row for `doc.document_type`. Effective rule = `policy.stamp_required && !(policy.signature_only_allowed && approverChoseTextOrSignatureOnly)`. Approver's `profiles.preferred_stamp_mode` only narrows the choice; it cannot bypass a policy that mandates a stamp.
- `PlacementModal.tsx`: hide / disable the "Text-only" and "Signature only" toggles when policy forbids them, with an inline note: "Stamp required for this document type."
- `stamp-document` edge function: re-check the policy server-side using `service_role` client; reject the request if signature-only is used on a type that requires stamp.

**Profile changes**

- Keep `profiles.preferred_stamp_mode` (UX default).
- Treat `profiles.stamp_required` as deprecated; the policy table is the source of truth. Migration leaves the column for backward-compat but UI in `ProfileSettings` is removed and replaced with a read-only "Policy summary" listing which document types accept signature-only for the current approver.

## Files

**New**
- `supabase/migrations/<ts>_document_type_policy.sql`
- `src/pages/admin/ApprovalPolicies.tsx`
- `src/components/admin/SystemResetCard.tsx` (shared between SystemSetup and SystemBackups)
- `src/hooks/useDocTypePolicy.ts`

**Modified**
- `src/hooks/useRoleGuard.ts` — refine `'export'`, add `'reset'`, reason strings.
- `src/pages/Reports.tsx`, `src/pages/admin/SessionExports.tsx`, `src/pages/trainer/MySubmissions.tsx`, `src/pages/admin/SystemBackups.tsx`, `src/pages/admin/ManageUsers.tsx`, `src/pages/admin/SystemSetup.tsx` — wrap action buttons.
- `src/hooks/useDocuments.ts` — policy-aware validation in `performApproval`.
- `src/components/common/PlacementModal.tsx` — hide disallowed modes per policy.
- `src/pages/ProfileSettings.tsx` — remove stamp-required toggle, add policy summary.
- `supabase/functions/stamp-document/index.ts` — server-side policy enforcement.

No changes to Google Drive flow or storage buckets.