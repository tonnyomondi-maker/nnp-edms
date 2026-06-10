import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SystemLockState {
  lock_active: boolean;
  lock_reason: string | null;
  locked_at: string | null;
  locked_by_email: string | null;
}

const EMPTY: SystemLockState = { lock_active: false, lock_reason: null, locked_at: null, locked_by_email: null };

export function useSystemLock() {
  const { user, currentUser, activeRole } = useAuth();
  const q = useQuery<SystemLockState>({
    queryKey: ['system_settings', 'lock'],
    enabled: !!user,
    refetchInterval: 8000, // poll so users notice within 8s of a lock
    queryFn: async () => {
      const { data } = await supabase
        .from('system_settings' as never)
        .select('lock_active,lock_reason,locked_at,locked_by_email')
        .eq('id' as never, 1 as never)
        .maybeSingle();
      return ((data as never) as SystemLockState) ?? EMPTY;
    },
  });

  const lock = q.data ?? EMPTY;
  const isSuperAdminActive = activeRole === 'SUPER_ADMIN' && !!currentUser?.roles.includes('SUPER_ADMIN');
  // Super Admin can still act while the lock is on so they can finish the operation.
  const writesBlocked = lock.lock_active && !isSuperAdminActive;

  return { ...lock, writesBlocked, isSuperAdminActive, refetch: q.refetch };
}
