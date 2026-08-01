// Super Admin institution-wide document browser.
// Same grouping controls as the DP and IQA queues so every oversight role sees
// documents organised per module/term, department, trainer or document type.

import { useState, useMemo, useEffect } from 'react';
import { useAllDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { GroupByControl, groupDocs, GroupSection, type GroupByKey } from '@/components/common/GroupByControl';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { Loader2 } from 'lucide-react';

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

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="All Documents" subtitle={`${docs.length} document(s) across the institution`} />
      <div className="mb-3 flex flex-wrap justify-end gap-2">
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
