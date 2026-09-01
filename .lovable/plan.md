# Fix: published portal shows a blank page

## What is happening

The published site at nnp-edms.lovable.app loads its HTML and JavaScript fine, but the app crashes immediately on start with the error `supabaseUrl is required.` — so nothing renders except the Lovable badge. The preview works because it has the backend connection values; the published build was produced before the project moved workspaces, so it went out without them.

## Fix

1. Republish the project so the current build picks up the correct backend connection values. This alone should restore the live portal.
2. Add a safety net so a missing/invalid backend configuration never produces a blank white screen again:
   - Fall back to the known project URL and publishable key when the build-time variables are absent, instead of calling the client with `undefined`.
   - Show a plain, branded "Portal configuration issue — please refresh / contact admin" screen instead of a silent crash.
3. Add a top-level error boundary around the app root so any future startup error renders a readable message with a retry button rather than an empty page.
4. Verify after publishing: load the live URL in a browser, confirm the sign-in screen renders and there are no console errors.

## Technical notes

- Crash origin: `src/integrations/supabase/client.ts` calls `createClient(import.meta.env.VITE_SUPABASE_URL, ...)`; when undefined, supabase-js throws during module evaluation, before React mounts, so no UI can render.
- That file is auto-generated and must not be edited. The fallback/guard goes in a small wrapper module plus `src/main.tsx`, leaving the generated client untouched.
- Same guard applies to the other direct `import.meta.env.VITE_SUPABASE_URL` uses (`SessionExports.tsx`, `AuditTrailButton.tsx`, `DriveRetryPanel.tsx`, `VerifyPack.tsx`) so edge-function calls don't hit `undefined/functions/v1/...`.
- No database, workflow, or permission changes are involved.
