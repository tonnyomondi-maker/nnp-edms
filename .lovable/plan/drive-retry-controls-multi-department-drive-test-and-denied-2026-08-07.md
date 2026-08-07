# Drive retry controls, multi-department Drive test, and denied-attempt CSV export

## 1. Retry failed Drive syncs and exports from Integration Health

A new "Failed Drive syncs & exports" card on Admin → Integration Health, above the folder map:

- Lists every approved/archived document whose Drive mirror failed (`gdrive_sync_status = failed`), showing department, trainer, file name, last error and last attempt time.
- **Retry** per row and **Retry all** for the whole list, with a live counter (`3/12 retried`) and a per-row success/failure result. Retrying reuses the existing Drive mirroring function, so no credential reconnect is needed — the linked workspace connection is used as-is.
- Lists failed/stalled ZIP export jobs (`export_progress` rows in a failed phase) with a **Re-run export** action for the same department and session.
- A "Sync all approved documents" action mirrors any DP-approved or archived document that has never reached Drive (`gdrive_file_id` empty), so the final approved copies always end up stored in Drive under `EDMS / Session / Department / Trainer`.
- Empty state confirms when nothing is pending, so a clean system shows "All approved documents are mirrored".

Current state: all documents in the system are mirrored successfully, so the card will start empty and populate whenever a sync fails.

## 2. Multi-department end-to-end Drive test

The existing single-file smoke test is extended into a departmental isolation test:

- Choose which departments to test (default: every department that has a mapped Drive folder).
- For each department the test: uploads a small generated PDF into that department's folder path, reads the file back, confirms the parent folder is the expected department folder (not another department's), checks the sharing/permission state is private to the connected account (not "anyone with the link"), then deletes only that test file and re-checks that the other departments' test files still exist.
- The result table shows, per department: upload OK, correct placement, sharing state, delete isolated, and latency. Failures show the exact Drive error.
- Results are stored as a normal health run so the history stays in "Recent runs".

I will run this test across the mapped departments once the change is in place and report the results back.

## 3. Denied attempts / security events CSV export

On Admin → Audit Log:

- A dedicated **Export denied attempts (CSV)** button next to the existing export, which always exports security events regardless of the current filter.
- The denied export uses security-specific columns: timestamp, action (e.g. denied notification insert, denied pack delete), actor id, actor email, target table, target id, reason, and the full details payload.
- A date-range selector (last 24h / 7 days / 30 days / all) applies to both exports.
- The existing all-events CSV stays as-is for the general trail.

This works with the data already being recorded today — denied notification inserts and denied pack deletions are logged to security events by the existing guards.

## Technical notes

- New `src/components/admin/DriveRetryPanel.tsx` queries `documents` (failed or unmirrored, approved states) and `export_progress`, and invokes `gdrive-upload` / `export-session-zip` sequentially with progress state; mounted in `IntegrationHealth.tsx`.
- `supabase/functions/drive-smoke-test/index.ts` gains an optional `departments: string[]` body param; per department it resolves the folder id from `drive_folder_map` (falling back to the folder tree resolver), uploads, verifies `parents` and `permissions`, deletes, then cross-checks sibling files. Steps are recorded per department in `integration_health_runs.steps`.
- `IntegrationHealth.tsx` gains a department multi-select for the smoke test and a per-department results table.
- `AuditLog.tsx` gains the denied-only CSV builder and the range selector; CSV escaping reuses the existing helper style from `src/lib/auditCsv.ts`.
- No schema changes required.
