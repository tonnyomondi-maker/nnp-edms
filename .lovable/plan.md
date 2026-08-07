# Security audit logging + Drive integration verification

## 1. Log and alert on denied security-sensitive attempts

Two actions are now blocked by database access rules: creating a notification for someone else's document, and permanently deleting a verification pack (Super Admin only). Today those denials fail silently.

- Add a new `log-security-event` backend function that records denied attempts with elevated privileges (so the record is written even though the original action was refused). It captures: who attempted it, what they tried, the target record, and the timestamp.
- Wire the notification helper and the verification-pack delete path so that when the database refuses the action, the attempt is logged instead of being swallowed.
- Surface these entries in the existing Super Admin Audit Log view with a distinct "DENIED" style, plus a filter to show only denied attempts.
- Add an alert banner on the Super Admin dashboard when any denied attempt occurred in the last 24 hours, linking to the filtered audit log.

## 2. Integration health check

Run the existing Integration Health check (Drive API status, required environment values, folder mapping) and report the outcome, including any failing Drive sync or export connection.

## 3. Re-link Drive folders

Run the "Re-link Drive folders" action so the EDMS folder map (root, session, department, trainer levels) is recreated for this workspace after the move, then confirm the resulting folder IDs are stored.

## 4. Drive smoke test

Run the Drive smoke test: upload a sample PDF, confirm it lands in the expected folder path, verify its sharing settings are restricted (not public), then download it back through the export path to confirm the fallback works. Report the folder path and share setting observed.

Order of execution: re-link folders first, then health check, then smoke test — the later steps depend on a valid folder map.

## Technical notes

- New table `security_events` (actor id, actor email, action, target table, target id, reason, details) with Super Admin read-only access and writes only from the backend service role.
- New edge function `log-security-event`, JWT-validated, writes with the service role and rejects unauthenticated calls.
- Client changes: `src/lib/notify.ts` and the verification pack delete/revoke call sites report failures to that function; `src/pages/admin/AuditLog.tsx` gains a denied-events tab.
- Steps 2-4 use the existing `drive-relink-folders`, `drive-healthcheck`, and `drive-smoke-test` functions and the `/admin/integration-health` screen; no new backend work is needed for them.
