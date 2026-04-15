import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

type DocumentStatus = Database['public']['Enums']['document_status'];

const statusStyles: Record<DocumentStatus, string> = {
  SUBMITTED: 'bg-status-submitted-bg text-status-submitted',
  HOD_APPROVED: 'bg-status-review-bg text-status-review',
  DP_APPROVED: 'bg-status-approved-bg text-status-approved',
  ARCHIVED: 'bg-status-archived-bg text-status-archived',
  REJECTED: 'bg-status-rejected-bg text-status-rejected',
};

const statusLabels: Record<DocumentStatus, string> = {
  SUBMITTED: 'Submitted',
  HOD_APPROVED: 'HOD Approved',
  DP_APPROVED: 'DP Approved',
  ARCHIVED: 'Archived',
  REJECTED: 'Rejected',
};

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold', statusStyles[status], className)}>
      {statusLabels[status]}
    </span>
  );
}
