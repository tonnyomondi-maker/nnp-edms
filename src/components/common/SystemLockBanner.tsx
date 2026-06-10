import { Lock } from 'lucide-react';
import { useSystemLock } from '@/hooks/useSystemLock';

export function SystemLockBanner() {
  const { lock_active, lock_reason, locked_by_email, isSuperAdminActive } = useSystemLock();
  if (!lock_active) return null;
  return (
    <div className="bg-destructive/10 border-b border-destructive/30 text-destructive text-xs px-3 py-2 flex items-start gap-2">
      <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-semibold">System safety lock is ACTIVE</div>
        <div className="opacity-80">
          {lock_reason || 'Super Admin maintenance in progress.'}
          {locked_by_email && <> — locked by {locked_by_email}</>}.
          {' '}Uploads, approvals and other writes are temporarily blocked
          {isSuperAdminActive && ' (Super Admin actions still allowed for you)'}
          .
        </div>
      </div>
    </div>
  );
}
