// Centralised UI permission guards. Approval actions check the user's
// ACTIVE role (the one they've toggled into in the TopBar) — not just
// whether they hold the role. Switching roles immediately changes what
// actions are exposed.

import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { useSystemLock } from '@/hooks/useSystemLock';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'>;
export type DocAction = 'upload' | 'list' | 'view' | 'export' | 'approve' | 'reject' | 'delete';

export function useRoleGuard() {
  const { currentUser, activeRole } = useAuth();
  const { writesBlocked, lock_active } = useSystemLock();
  const has = (r: UserRole) => !!currentUser?.roles.includes(r);
  const isActive = (r: UserRole) => activeRole === r;
  const isWrite = (a: DocAction) => a === 'upload' || a === 'approve' || a === 'reject' || a === 'delete';

  function canActOn(action: DocAction, doc?: Doc | null): boolean {
    if (isWrite(action) && writesBlocked) return false;

    switch (action) {
      case 'list':
      case 'view':
      case 'export':
        // Read/export is available to any signed-in role with the page's
        // baseline access; lock does not block reads.
        return true;
      case 'upload':
        return isActive('TRAINER') && has('TRAINER');
      case 'approve':
      case 'reject':
        if (!doc) {
          return (
            (isActive('HOD') && has('HOD')) ||
            (isActive('DP_ACADEMICS') && has('DP_ACADEMICS')) ||
            (isActive('IQA') && has('IQA'))
          );
        }
        if (isActive('HOD') && has('HOD') && doc.status === 'SUBMITTED') {
          return !currentUser?.department || doc.department === currentUser.department;
        }
        if (isActive('DP_ACADEMICS') && has('DP_ACADEMICS') && doc.status === 'HOD_APPROVED') return true;
        if (isActive('IQA') && has('IQA') && doc.status === 'DP_APPROVED') return true;
        return false;
      case 'delete':
        return isActive('SUPER_ADMIN') && has('SUPER_ADMIN');
      default:
        return false;
    }
  }

  function reasonFor(action: DocAction, doc?: Doc | null): string | null {
    if (canActOn(action, doc)) return null;
    if (isWrite(action) && writesBlocked) return 'System safety lock is active — writes are temporarily blocked.';
    if (action === 'upload') return 'Switch to your Trainer role to upload documents.';
    if (action === 'approve' || action === 'reject') {
      if (doc?.status === 'SUBMITTED') return 'Switch to your HOD role (and department) to verify this document.';
      if (doc?.status === 'HOD_APPROVED') return 'Switch to your DP Academics role to approve this document.';
      if (doc?.status === 'DP_APPROVED') return 'Switch to your IQA role to archive this document.';
      return 'Switch to the role that owns this approval stage.';
    }
    if (action === 'delete') return 'Only Super Admin can delete documents.';
    return 'You do not have permission for this action in your current role.';
  }

  return {
    activeRole,
    lockActive: lock_active,
    writesBlocked,
    isSuperAdmin: has('SUPER_ADMIN'),
    canActOn,
    reasonFor,
    // Back-compat short forms kept for existing callers:
    canVerifyAsHOD: (doc?: Doc | null) => canActOn('approve', doc) && isActive('HOD'),
    canApproveAsDP: (doc?: Doc | null) => canActOn('approve', doc) && isActive('DP_ACADEMICS'),
    canArchiveAsIQA: (doc?: Doc | null) => canActOn('approve', doc) && isActive('IQA'),
    canUploadAsTrainer: () => canActOn('upload'),
    canManageUsers: () => isActive('SUPER_ADMIN') && has('SUPER_ADMIN'),
  };
}

export function roleLabel(r: UserRole): string {
  return ({
    TRAINER: 'Trainer',
    HOD: 'Head of Department',
    DP_ACADEMICS: 'Deputy Principal Academics',
    IQA: 'Internal Quality Assurance',
    SUPER_ADMIN: 'Super Admin',
  } as Record<UserRole, string>)[r];
}
