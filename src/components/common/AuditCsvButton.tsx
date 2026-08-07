import { useState } from 'react';
import { buildAuditCsv, downloadCsv } from '@/lib/auditCsv';
import { toast } from '@/hooks/use-toast';
import { Sheet, Loader2 } from 'lucide-react';

interface Props {
  documentId: string;
  fileNameHint?: string | null;
}

/** Pill button that downloads the stamping/audit trail of one document as CSV. */
export function AuditCsvButton({ documentId, fileNameHint }: Props) {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const csv = await buildAuditCsv({ documentIds: [documentId] });
      const safe = (fileNameHint || documentId).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
      downloadCsv(csv, `audit-trail-${safe}.csv`);
    } catch (e) {
      toast({
        title: 'Could not export audit CSV',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium disabled:opacity-50"
      title="Export stamping & audit trail as CSV"
    >
      {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sheet className="w-2.5 h-2.5" />}
      CSV
    </button>
  );
}
