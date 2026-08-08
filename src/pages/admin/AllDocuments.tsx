// Super Admin institution-wide document browser.
// Same grouping controls as the DP and IQAO queues so every oversight role sees
// documents organised per module/term, department, trainer or document type.

import { useState, useMemo, useEffect } from 'react';
import { useAllDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { GroupByControl, groupDocs, GroupSection, type GroupByKey } from '@/components/common/GroupByControl';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { Button } from '@/components/ui/button';
import { buildAuditCsv, downloadCsv } from '@/lib/auditCsv';
import { toast } from '@/hooks/use-toast';
import { Loader2, Sheet } from 'lucide-react';

export default function AllDocuments() {
  const { data, isLoading } = useAllDocuments();
  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByKey>('STAGE');
  const [filter, setFilter] = useState<QueueFilterValue>({ ...DEFAULT_QUEUE_FILTER });

  const baseDocs = useMemo(() => data || [], [data]);
  useEffect(() => {
    if (!termInitialized && baseDocs.length > 0) {
      setTermFilter(pickDefaultTerm(baseDocs));
      setTermInitialized(true);
    }
  }, [baseDocs, termInitialized]);

  const counts = useMemo(() => termCounts(baseDocs), [baseDocs]);
  const docs = useMemo(
    () => applyQueueFilter(filterByTerm(baseDocs, termFilter), filter),
    [baseDocs, termFilter, filter],
  );

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await buildAuditCsv({ documentIds: docs.map((d) => d.id) });
      downloadCsv(csv, `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast({
        title: 'Could not export audit CSV',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="All Documents" subtitle={`${docs.length} document(s) across the institution`} />
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting || docs.length === 0}>
          {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sheet className="w-3.5 h-3.5 mr-1" />}
          Audit CSV ({docs.length})
        </Button>
        <GroupByControl value={groupBy} onChange={setGroupBy} />
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>
      <QueueFilterBar value={filter} onChange={setFilter} docs={baseDocs} />
      <div className="space-y-3 mt-3">
        {docs.length > 0 ? (
          groupDocs(docs, groupBy).map((group) => (
            <GroupSection key={group.key} label={group.label} count={group.docs.length}>
              {group.docs.map((doc) => <DocumentCard key={doc.id} doc={doc} showTrainer />)}
            </GroupSection>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No documents match the current filters</p>
        )}
      </div>
    </div>
  );
}
