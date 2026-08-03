import { Check, Clock, XCircle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'> & {
  returned_at?: string | null;
  return_note?: string | null;
};

const STAGES = [
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'HOD_APPROVED', label: 'HOD' },
  { key: 'IQA_REVIEWED', label: 'IQA review' },
  { key: 'DP_APPROVED', label: 'DP' },
  { key: 'ARCHIVED', label: 'Archived' },
] as const;

export function ProgressTracker({ doc }: { doc: Doc }) {
  const rejected = doc.status === 'REJECTED';
  const returned = !!doc.returned_at && doc.status !== 'ARCHIVED';

  const currentIndex =
    doc.status === 'ARCHIVED' ? 4
      : doc.status === 'DP_APPROVED' ? 3
      : doc.status === 'IQA_REVIEWED' ? 2
      : doc.status === 'HOD_APPROVED' ? 1
      : 0;

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {STAGES.map((s, i) => {
        const done = !rejected && i <= currentIndex && !(returned && i === currentIndex);
        const active = !rejected && i === currentIndex && !returned;
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center border text-[10px] flex-shrink-0',
              done ? 'bg-primary border-primary text-primary-foreground'
                : active ? 'border-primary text-primary'
                : rejected && i === currentIndex ? 'border-destructive text-destructive'
                : returned && i === currentIndex ? 'border-amber-500 text-amber-600'
                : 'border-muted-foreground/40 text-muted-foreground/60'
            )}>
              {done ? <Check className="w-3 h-3" />
                : rejected && i === currentIndex ? <XCircle className="w-3 h-3" />
                : returned && i === currentIndex ? <RotateCcw className="w-3 h-3" />
                : active ? <Clock className="w-3 h-3" />
                : i + 1}
            </div>
            <span className={cn(
              'ml-1 text-[10px] truncate',
              done || active ? 'text-foreground' : 'text-muted-foreground/60'
            )}>{s.label}</span>
            {i < STAGES.length - 1 && (
              <div className={cn(
                'flex-1 h-px mx-1',
                done ? 'bg-primary' : 'bg-muted-foreground/20'
              )} />
            )}
          </div>
        );
      })}
      {returned && doc.return_note && (
        <div className="w-full mt-1 text-[10px] text-amber-600 dark:text-amber-400 truncate" title={doc.return_note}>
          ↩ Returned: {doc.return_note}
        </div>
      )}
    </div>
  );
}
