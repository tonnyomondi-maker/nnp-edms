# Drive account, archival errors, and the duplicated Personal Timetable

## 1. Google Drive account

Checked the live connection: the portal is already authenticated as **Power Manager – Nyamira National Polytechnic (ups@nyamirapoly.ac.ke)**, and uploads target the shared drive **"NNP EDMS"** (the only mapped root folder). So it is not a personal test Gmail account.

Two things to settle:

- If `ups@nyamirapoly.ac.ke` is not the official EDMS owner account, I will open a reconnect card so you sign in with the correct institutional account, then re-run "Re-link Drive folders" and the health check so the folder map points at the official shared drive.
- If it is the right account but the wrong destination folder, I will re-point the root mapping to the official EDMS shared drive and rebuild the Session / Department / Trainer / Unit branches under it.

Either way, after the switch I run the integration health check plus one end-to-end submission so a file is proven to land in `NNP EDMS / 01 - PENDING / <Session> / ...`.

## 2. Errors during DP Academics approval and IQAO archival

Backend logs show two real failures, both explaining what you saw (export worked, but errors flashed):

**a. Drive archival failure — "A shared drive item must have exactly one parent"**
When a document is finalised, the file is moved from PENDING to APPROVED - ARCHIVE. The code first reads the file's current folder so it can detach it — but that read is made without shared-drive support, so on the NNP EDMS shared drive it fails, the old folder list comes back empty, and the move then tries to add a second parent, which shared drives forbid. Fix: read the file with shared-drive support on both move paths, refuse to move when the current parent cannot be determined, and surface the Drive error text instead of a generic retry-until-502.

**b. Stamping failure — signature image could not be read**
The stamping function failed twice with an empty storage error while fetching an approver's signature, even though the signature file does exist. Fix: retry the fetch, fall back to a short-lived signed URL when the direct read returns an empty error, and return a plain-language message ("your saved signature could not be read — re-save it in Profile Settings") instead of a 500.

After both fixes I redeploy the affected functions and re-run a DP approve → IQAO archive cycle on a test document to confirm the file physically moves into `02 - APPROVED - ARCHIVE`.

## 3. Personal Timetable appearing twice for approvers

Confirmed there is only **one** Personal Timetable row in the database for that trainer, so this is a display bug. In the grouped approver view, session-level documents (Personal Timetable, Workload Allocation) are pinned in a highlighted panel at the trainer level and removed from the nested unit groups. But when a trainer has *only* session-level documents, the nested groups come out empty and the view falls back to listing every document of that trainer — including the one already pinned above.

Fix: the fallback list will use the same filtered set as the nested groups, so a pinned document is never listed twice. Also relabel the panel from "Workload allocation" to "Session documents", since it now holds the Personal Timetable too.

## Technical notes

- `supabase/functions/gdrive-upload/index.ts`: add `supportsAllDrives=true` to the two `files/{id}?fields=id,parents` reads; abort the move with a clear error if parents are unknown; propagate Drive's response body in errors.
- `supabase/functions/stamp-document/index.ts`: harden `fetchImageAsset` with one retry plus a signed-URL fallback, and map asset failures to a friendly 4xx message.
- `src/components/common/HierarchyGroups.tsx`: keep the non-pinned document list on each node and render that in the leaf fallback instead of `node.docs`; update the panel heading.
- Redeploy `gdrive-upload` and `stamp-document`; re-run integration health check and Drive re-link after any account change.
