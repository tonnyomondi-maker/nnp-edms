
# Google Drive Integration Health & Recovery

Adds a Super Admin screen to verify the Drive integration end-to-end after the workspace move, plus tooling to re-map department folders. Trainer uploads stay Supabase-only; Drive remains the backup/offload target.

## 1. New page: `/admin/integration-health`

Super Admin only. Sections:

- **Environment check** — verifies presence (never values) of `LOVABLE_API_KEY`, `GOOGLE_DRIVE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. Green/red pill per var.
- **Drive API status** — calls new `drive-healthcheck` edge function which hits `/drive/v3/about?fields=user,storageQuota` through the gateway. Shows connected account email, quota used/limit, latency.
- **Folder map** — lists the EDMS root folder + one row per department (from `profiles.department` distinct list). For each: folder name, Drive folder ID, "verify" result (exists / writable / missing), last checked time. Pulled from a new `drive_folder_map` table.
- **Last smoke test result** — timestamp, pass/fail per step (upload → list → download-via-export → cleanup), duration, error text if any. Persisted in `integration_health_runs` table so the panel survives refresh.
- **Actions bar**: `Run health check`, `Run smoke test`, `Re-link Drive folders`. All gated by `ActionGuardButton` (Super Admin only).

## 2. New edge function: `drive-healthcheck`

- Auth: Super Admin only (verify JWT + `has_role`).
- Steps: env-var presence → `GET /drive/v3/about` → for each folder in `drive_folder_map`, `GET /drive/v3/files/{id}?fields=id,name,capabilities(canAddChildren,canEdit),trashed`.
- Writes one row to `integration_health_runs` with per-step JSON results.

## 3. New edge function: `drive-smoke-test`

- Auth: Super Admin only.
- Generates a tiny in-memory PDF (1 page, "EDMS smoke test <timestamp>").
- Uploads it via the existing gateway multipart endpoint into the EDMS root folder → captures `fileId`.
- Inserts a temporary `documents` row (status `ARCHIVED`, `storage_tier='drive'`, `gdrive_file_id=fileId`, department `__SMOKE__`, session flagged) so `export-session-zip` fallback path is exercised.
- Invokes `export-session-zip` with the smoke session filter; asserts the returned ZIP contains the sample PDF (byte-length match).
- Cleanup: deletes the Drive file, the temp document row, and any audit rows tagged `smoke_test:true`.
- Result row written to `integration_health_runs` with each step's outcome.

## 4. New edge function: `drive-relink-folders`

- Auth: Super Admin only.
- Input: `{ mode: 'discover' | 'create', rootFolderName?: string }`.
- `discover`: searches Drive for a folder named "EDMS" (or provided name) at root and for `EDMS/<Department>` children; returns candidate IDs without writing.
- `create`: idempotently creates the root + one subfolder per distinct `profiles.department`, then upserts rows into `drive_folder_map`.
- Returns the resulting map so the UI can preview before persisting when in discover mode.

## 5. Database

New migration:

- `drive_folder_map(id, scope text check in ('root','department'), department text null, folder_id text not null, folder_name text, updated_at, updated_by)`
- `integration_health_runs(id, kind text check in ('healthcheck','smoke_test'), status text, started_at, finished_at, actor uuid, steps jsonb, error text)`
- GRANTs: `authenticated` SELECT/INSERT/UPDATE only via edge functions; RLS policies restrict all client access to `has_role(auth.uid(),'SUPER_ADMIN')`. `service_role` full access.

## 6. Wiring / non-goals

- Route added in `App.tsx`; nav entry in Super Admin section of `BottomNav`.
- `gdrive-upload` (trainer path) is **not** invoked from upload flow — confirmed current `UploadDocuments` already uploads to Supabase Storage only; Drive mirroring happens through `offload-to-drive` and `run-offload-schedules`. No change to trainer behaviour.
- Existing `export-session-zip` unchanged except that the smoke test passes a synthetic session filter it already supports.

## Technical notes

- Health/smoke functions use `verify_jwt = true` (default) and re-check `SUPER_ADMIN` role server-side.
- Gateway calls use `Authorization: Bearer ${LOVABLE_API_KEY}` + `X-Connection-Api-Key: ${GOOGLE_DRIVE_API_KEY}` per existing pattern in `export-session-zip`.
- Smoke test writes are wrapped in try/finally so cleanup always runs even on failure.
- All destructive re-link operations require typed confirmation in the UI, similar to `SystemResetCard`.
