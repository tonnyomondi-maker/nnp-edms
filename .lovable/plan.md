## Verified current state

- Document queries in `useDocuments.ts` select `*, teaching_assignments(*)` — no join to `profiles`. `GroupByControl.groupDocs` reads `d.profiles?.full_name`, so "Group by Trainer" always falls back to "Unknown". This is the trainer-name bug.
- `gdrive-upload` builds only a *label* string `EDMS/{year}_{term}/{dept}/{unit}` in the file description and uploads flat; the code comment states `drive.file` scope prevents folder creation. Nothing is nested in Drive today. `drive_folder_map` (root + department scopes only) exists from the re-link work.
- `system-reset` deletes `documents, audit_logs, role_change_audit, unit_session_config, teaching_assignments` only. Packs (`verification_packs`, `verification_pack_assignees`), `verifier_reviews`, `verifiers`, plus `export_progress`, `backup_metadata`, `integration_health_runs` survive a reset.
- `GroupByControl` + `GroupSection` already exist and are wired into DP Approval Queue and both IQA archive tabs; Super Admin views are not yet grouped.

## Plan

### 1. Fix trainer names in grouping

- Extend the document selects in `useDocuments.ts` to include the trainer profile: `*, teaching_assignments(*), profiles:trainer_id (full_name, pf_number, department)`.
- If the FK embed isn't resolvable, fall back to a single batched `profiles` fetch keyed by `trainer_id` inside the hook and attach a `profiles` field client-side.
- No change needed in `GroupByControl` — it already reads `profiles.full_name` / `pf_number`.

### 2. Consistent module-based grouping everywhere

- Default `GroupByControl` to `STAGE` (Term/Module) on DP Approval Queue, IQA Archive (both tabs) and add it to the Super Admin document surfaces in `RoleDashboardBlocks.tsx` (and any admin doc list it renders).
- Persist the chosen grouping per role in `localStorage` so the view stays consistent between screens and reloads.

### 3. IQA archival → nested ZIP, resilient to partial failures

- In `ArchiveScreen.tsx`, run archival per document, collecting `{ok, failed[]}` instead of aborting on first error.
- After the run, always offer/trigger the nested ZIP via `export-session-zip` with `nested: true` and the current department/stage filter, so a partial archival still yields a `Department/Trainer/*.pdf` download.
- Show a summary toast: `N archived, M failed` plus an expandable list of failures with the server message, and a "Retry failed" action.

### 4. Bulk signing for IQA and DP

- Add "Sign & approve all in this group" in the group header (and a select-all checkbox on cards) for DP and IQA.
- One placement pass: the user positions signature/stamp once in `PlacementModal`; the chosen page/coords/size/opacity are reused for every selected document (with a "last page" option so varying page counts still work).
- Run through the existing `stamp-document` path sequentially with a progress panel (`x of N`), continue past failures, and report a per-document result list at the end.
- Also for the HOD

### 5. Organized Google Drive folder structure

- Extend `drive_folder_map` usage with scopes `stage` (Term/Module) and `trainer`, keyed by department.
- Add a folder resolver in a shared helper used by `gdrive-upload` and `offload-to-drive`: ensure/create `EDMS / <Department> / <Term N|Module N> / <PF> - <Trainer Name>` and upload the file into that folder id, caching resolved ids in `drive_folder_map`.
- Requires the Drive connector scope to allow folder creation. If create calls fail with a scope error, the function keeps working (flat upload + clear health-check warning) rather than failing the mirror.
- Update `drive-relink-folders` "create" mode to build the department → stage skeleton, and surface the tree on `/admin/integration-health`.

### 6. Reset clears packs and verifiers

- Extend the `system-reset` delete list to: `verification_pack_assignees`, `verification_packs`, `verifier_reviews`, `verifiers`, `export_progress`, `integration_health_runs`, `backup_metadata` (in FK-safe order), keeping `profiles`, `user_roles`, `system_settings` untouched as today.
- Update the confirmation dialog copy in `SystemResetCard.tsx` to list exactly what is wiped and that only users/roles/settings remain.

Then can we also have a guide on how to use the system embeded?

## Technical notes

- No schema change expected except possibly widening `drive_folder_map.scope` values; if a check constraint blocks `stage`/`trainer`, that's one migration.
- Bulk signing reuses `stamp-document` per document — no new server endpoint, so all existing policy/SLA enforcement still applies.