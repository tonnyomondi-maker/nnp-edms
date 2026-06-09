// Centralised UI permission guards. Approval actions check the user's
// ACTIVE role (the one they've toggled into in the TopBar) — not just
// whether they hold the role. Switching roles immediately changes what
// actions are exposed.

import { useAuth, type UserRole } from '@/contexts/AuthContext';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'>;

export function useRoleGuard() {
  const { currentUser, activeRole } = useAuth();
  const has = (r: UserRole) => !!currentUser?.roles.includes(r);
  const isActive = (r: UserRole) => activeRole === r;

  return {
    activeRole,
    isSuperAdmin: has('SUPER_ADMIN'),
    // Each guard requires the role to be both held AND currently active.
    canVerifyAsHOD: (doc?: Doc | null) => {
      if (!isActive('HOD') || !has('HOD')) return false;
      if (!doc) return true;
      if (doc.status !== 'SUBMITTED') return false;
      // HOD can only verify documents in their own department
      if (currentUser?.department && doc.department !== currentUser.department) return false;
      return true;
    },
    canApproveAsDP: (doc?: Doc | null) => {
      if (!isActive('DP_ACADEMICS') || !has('DP_ACADEMICS')) return false;
      if (!doc) return true;
      return doc.status === 'HOD_APPROVED';
    },
    canArchiveAsIQA: (doc?: Doc | null) => {
      if (!isActive('IQA') || !has('IQA')) return false;
      if (!doc) return true;
      return doc.status === 'DP_APPROVED';
    },
    canUploadAsTrainer: () => isActive('TRAINER') && has('TRAINER'),
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
