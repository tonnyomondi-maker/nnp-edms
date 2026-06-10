// Server-truth lock check used by mutations. We re-read system_settings
// just before performing the write so a Super Admin lock instantly blocks
// all other users even if their client poll hasn't caught up yet.

import { supabase } from '@/integrations/supabase/client';

export async function assertSystemNotLocked(currentUserId?: string): Promise<void> {
  const { data } = await supabase
    .from('system_settings' as never)
    .select('lock_active,locked_by,lock_reason')
    .eq('id' as never, 1 as never)
    .maybeSingle();
  const row = (data as { lock_active?: boolean; locked_by?: string | null; lock_reason?: string | null } | null) ?? null;
  if (!row?.lock_active) return;
  // Super Admin who engaged the lock can still operate (lets them finish).
  if (currentUserId && row.locked_by === currentUserId) return;
  throw new Error(row.lock_reason ? `System safety lock active: ${row.lock_reason}` : 'System safety lock is active — writes are temporarily blocked.');
}
