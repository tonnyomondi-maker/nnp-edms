import { DocumentStatus, getStatusLabel } from '@/data/mockData';
import { cn } from '@/lib/utils';

const statusStyles: Record<DocumentStatus, string> = {
  SUBMITTED: 'bg-status-submitted-bg text-status-submitted',
  HOD_APPROVED: 'bg-status-review-bg text-status-review',
  DP_APPROVED: 'bg-status-approved-bg text-status-approved',
  ARCHIVED: 'bg-status-archived-bg text-status-archived',
  REJECTED: 'bg-status-rejected-bg text-status-rejected',
};

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold', statusStyles[status], className)}>
      {getStatusLabel(status)}
    </span>
  );
}
