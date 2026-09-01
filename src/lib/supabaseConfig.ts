// Backend connection values used by direct fetch() calls to edge functions.
// Vite inlines VITE_* at build time; if a build ever ships without them we fall
// back to the known project values so the portal keeps working instead of
// issuing requests to "undefined/functions/v1/...".
// These values are public by design (RLS protects the data).

const FALLBACK_URL = 'https://yqxmtxivimuqowxuqumr.supabase.co';
const FALLBACK_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxeG10eGl2aW11cW93eHVxdW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjU2NTgsImV4cCI6MjA5MTg0MTY1OH0.P9EHyir1XX8uTJX-7TkFz6OyGJdkJ5OyVaZ-V1RoB68';

export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || FALLBACK_URL;

export const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || FALLBACK_KEY;

export const functionUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
