// Client helper: report denied / blocked security-sensitive attempts so they land
// in the Super Admin audit trail instead of failing silently.

import { supabase } from '@/integrations/supabase/client';

export type SecurityAction =
  | 'DENIED_NOTIFICATION_INSERT'
  | 'DENIED_PACK_DELETE'
  | 'DENIED_PACK_REVOKE';

export interface SecurityEventInput {
  action: SecurityAction;
  targetTable?: string;
  targetId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

/** Postgres/PostgREST codes that mean "row level security refused this". */
export function isPermissionDenied(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    msg.includes('row-level security') ||
    msg.includes('row level security') ||
    msg.includes('permission denied')
  );
}

export async function logSecurityEvent(input: SecurityEventInput) {
  try {
    await supabase.functions.invoke('log-security-event', {
      body: {
        action: input.action,
        target_table: input.targetTable ?? null,
        target_id: input.targetId ?? null,
        reason: input.reason ?? null,
        details: input.details ?? {},
      },
    });
  } catch {
    /* logging is best-effort — never block the user flow */
  }
}
