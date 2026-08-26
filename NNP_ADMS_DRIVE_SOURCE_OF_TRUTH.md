# NNP ADMS — Google Drive source-of-truth fix

## Important
The browser app and Supabase Edge Functions are separate deployment targets.
Changing `supabase/functions/*` in this VS Code copy does **not** change the already-deployed Edge Functions.

The observed symptoms — old `Unassigned Course` paths and `Storage reference is invalid` — are consistent with the deployed Edge Functions still running an older implementation.

## Required Edge Functions to deploy together
- `gdrive-upload`
- `gdrive-download`
- `stamp-document`

## Storage rule
Google Drive is the sole binary PDF repository. Supabase stores metadata and the Drive file ID/reference.

## Target tree
`NNP ADMS / 01 - PENDING / <SESSION> / <DEPARTMENT> / <TRAINER> /`
- `00 - Session Documents / Personal Timetable, Workload Allocation`
- `01 - Unit Documents / 01 - One-Time / <COURSE> / <UNIT>`
- `01 - Unit Documents / 02 - Recurring / <COURSE> / <UNIT>`

Approved/archived documents use the same branch under `02 - APPROVED - ARCHIVE`.
