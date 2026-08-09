// Amber "previously rejected" banner. Every approver (HOD, IQAO, DP) sees it so
// they can check the earlier comments were actually addressed.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { STAGE_LABEL } from '@/lib/notify';

interface RejectionRow {
  id: string;
  stage: string;
  reason: string | null;
  rejected_by_name: string | null;
  document_version: number;
  created_at: string;
}

export function useRejectionHistory(documentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['document_rejections', documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_rejections' as never)
        .select('*')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RejectionRow[];
    },
    enabled,
  });
}

interface Props {
  doc: {
    id: string;
    rejection_count?: number | null;
    last_rejected_stage?: string | null;
    last_rejection_reason?: string | null;
    last_rejected_at?: string | null;
    resubmission_note?: string | null;
    version?: number | null;
    status?: string;
  };
}

export function RejectionHistoryBanner({ doc }: Props) {
  const [open, setOpen] = useState(false);
  const count = doc.rejection_count ?? 0;
  const { data: history } = useRejectionHistory(doc.id, open && count > 0);
  if (!count || doc.status === 'REJECTED') return null;

  const office = doc.last_rejected_stage ? (STAGE_LABEL[doc.last_rejected_stage] || doc.last_rejected_stage) : 'an approver';

  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px]">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            Previously rejected {count} time{count === 1 ? '' : 's'} — now version {doc.version ?? 1}
          </p>
          <p className="text-amber-900/80 dark:text-amber-200/80">
            Last rejected by {office}
            {doc.last_rejected_at ? ` on ${new Date(doc.last_rejected_at).toLocaleDateString()}` : ''}
            {doc.last_rejection_reason ? `: ${doc.last_rejection_reason}` : ''}
          </p>
          {doc.resubmission_note && (
            <p className="mt-1 text-amber-900 dark:text-amber-200">
              <span className="font-semibold">Trainer says they changed: </span>{doc.resubmission_note}
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex items-center gap-0.5 font-medium underline text-amber-800 dark:text-amber-300"
          >
            Compare with previous reasons {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1">
              {(history || []).map((h) => (
                <li key={h.id} className="rounded bg-background/60 px-2 py-1">
                  <span className="font-medium">v{h.document_version} · {STAGE_LABEL[h.stage] || h.stage}</span>
                  {h.rejected_by_name ? ` · ${h.rejected_by_name}` : ''} · {new Date(h.created_at).toLocaleString()}
                  {h.reason ? <div className="text-muted-foreground">{h.reason}</div> : null}
                </li>
              ))}
              {history && history.length === 0 && <li className="text-muted-foreground">No detailed history recorded.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
