import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'>;

interface DocStatusTimelineProps {
  doc: Pick<
    Doc,
    | 'status'
    | 'submitted_at'
    | 'trainer_id'
    | 'hod_approved_at'
    | 'hod_approved_by'
    | 'dp_approved_at'
    | 'dp_approved_by'
    | 'archived_at'
    | 'iqa_archived_by'
    | 'rejection_reason'
    | 'returned_at'
    | 'returned_by'
    | 'return_note'
  >;
  /** Smaller layout for inline use inside cards */
  compact?: boolean;
}

function durationBetween(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 48) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

type Approver = { full_name: string | null; pf_number: string | null };

function fmt(ts: string | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface Step {
  key: 'submitted' | 'hod' | 'dp' | 'archived';
  label: string;
  at: string | null;
  approverId: string | null | undefined;
  done: boolean;
}

export function DocStatusTimeline({ doc, compact = false }: DocStatusTimelineProps) {
  const [approvers, setApprovers] = useState<Map<string, Approver>>(new Map());

  useEffect(() => {
    const ids = [doc.trainer_id, doc.hod_approved_by, doc.dp_approved_by, doc.iqa_archived_by]
      .filter((x): x is string => !!x);
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('user_id, full_name, pf_number')
      .in('user_id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const m = new Map<string, Approver>();
        data.forEach((p) =>
          m.set(p.user_id, { full_name: p.full_name, pf_number: p.pf_number }),
        );
        setApprovers(m);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.trainer_id, doc.hod_approved_by, doc.dp_approved_by, doc.iqa_archived_by]);

  const rejected = doc.status === 'REJECTED';

  // Determine which stage rejection happened at
  const rejectedAt: Step['key'] | null = rejected
    ? doc.dp_approved_at
      ? 'archived'
      : doc.hod_approved_at
        ? 'dp'
        : 'hod'
    : null;

  const steps: Step[] = [
    {
      key: 'submitted',
      label: 'Submitted',
      at: doc.submitted_at,
      approverId: doc.trainer_id,
      done: !!doc.submitted_at,
    },
    {
      key: 'hod',
      label: 'HOD Approved',
      at: doc.hod_approved_at,
      approverId: doc.hod_approved_by,
      done: !!doc.hod_approved_at,
    },
    {
      key: 'dp',
      label: 'DP Academics Approved',
      at: doc.dp_approved_at,
      approverId: doc.dp_approved_by,
      done: !!doc.dp_approved_at,
    },
    {
      key: 'archived',
      label: 'IQA Archived',
      at: doc.archived_at,
      approverId: doc.iqa_archived_by,
      done: !!doc.archived_at,
    },
  ];

  const dotSize = compact ? 'w-5 h-5' : 'w-7 h-7';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const labelSize = compact ? 'text-[11px]' : 'text-xs';
  const subSize = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <ol className="space-y-1.5">
      {steps.map((s, idx) => {
        const isRejectionPoint = rejectedAt === s.key;
        const approver = s.approverId ? approvers.get(s.approverId) : null;
        const showAsRejected = isRejectionPoint && rejected;
        const dotClass = showAsRejected
          ? 'bg-destructive/15 text-destructive'
          : s.done
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground';

        return (
          <li key={s.key} className="flex items-start gap-2">
            <div className="flex flex-col items-center" aria-hidden="true">
              <div
                className={`${dotSize} flex-shrink-0 rounded-full flex items-center justify-center ${dotClass}`}
              >
                {showAsRejected ? (
                  <XCircle className={iconSize} />
                ) : s.done ? (
                  <CheckCircle2 className={iconSize} />
                ) : (
                  <Clock className={iconSize} />
                )}
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`w-px flex-1 min-h-[8px] mt-0.5 ${s.done ? 'bg-primary/30' : 'bg-border'}`}
                />
              )}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={`${labelSize} font-medium ${showAsRejected ? 'text-destructive' : ''}`}
                >
                  {showAsRejected ? `Rejected at ${s.label.replace(' Approved', '').replace(' Archived', '')}` : s.label}
                </p>
                {s.at && (
                  <span className={`${subSize} text-muted-foreground whitespace-nowrap`}>
                    {fmt(s.at)}
                  </span>
                )}
              </div>
              {s.done && approver?.full_name && (
                <p className={`${subSize} text-muted-foreground truncate`}>
                  by {approver.full_name}
                  {approver.pf_number ? ` • PF ${approver.pf_number}` : ''}
                </p>
              )}
              {!s.done && !showAsRejected && (
                <p className={`${subSize} text-muted-foreground`}>Pending</p>
              )}
              {showAsRejected && doc.rejection_reason && (
                <p
                  className={`${subSize} mt-0.5 px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/20`}
                >
                  <span className="font-semibold">Reason: </span>
                  {doc.rejection_reason}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
