# NNP ADMS — Reconstructed Fixes Snapshot

This archive was reconstructed from the saved Trainer UX + Google Drive Primary snapshot, with the latest corrected Google Drive upload function overlaid.

## Preserved Trainer/UI work
- Base: `NNP-ADMS-Trainer-UX-GoogleDrive-Primary-20260817.zip`
- Preserves the Trainer UI/UX versions captured in that snapshot, including the Trainer pages and related components.

## Latest Google Drive correction
- `supabase/functions/gdrive-upload/index.ts` was taken from the later clean Google Drive snapshot (`NNP-ADMS-Google-Drive-Fixed-Clean.zip`).
- `supabase/functions/gdrive-download/index.ts` remains from the Trainer UX + Google Drive Primary snapshot; it matches the later clean snapshot.

## Documentation
- `NNP_ADMS_PHASE1_STORAGE_REFACTOR.md` was taken from the later clean snapshot.

## Security
- `.env` is intentionally excluded from this archive. Do not commit API keys, service-role keys, or other secrets.
