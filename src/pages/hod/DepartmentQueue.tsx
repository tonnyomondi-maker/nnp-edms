import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentsByDepartment, useBulkUpdateDocumentStatus, useUpdateDocumentStatus, type ApprovalPlacement } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { BulkActionBar } from '@/components/common/BulkActionBar';
import { PlacementModal } from '@/components/common/PlacementModal';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getCachedSignedUrl } from '@/hooks/useSignedDocUrl';
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';

export default function DepartmentQueue() {
  const { currentUser } = useAuth();
  const { data: queue, isLoading } = useDocumentsByDepartment(currentUser?.department || '');
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);
  const [filter, setFilter] = useState<QueueFilterValue>({ ...DEFAULT_QUEUE_FILTER, status: 'SUBMITTED' });

  const baseQueue = useMemo(
    () => (queue || []).filter(d => d.trainer_id !== currentUser?.id),
    [queue, currentUser?.id]
  );

  const myActioned = useMemo(
    () => (queue || []).filter((d) => d.hod_approved_by === currentUser?.id),
    [queue, currentUser?.id],
  );

  useEffect(() => {
    if (!termInitialized && baseQueue.length > 0) {
      setTermFilter(pickDefaultTerm(baseQueue));
      setTermInitialized(true);
    }
  }, [baseQueue, termInitialized]);

  const counts = useMemo(() => termCounts(baseQueue), [baseQueue]);
  const termFiltered = useMemo(() => filterByTerm(baseQueue, termFilter), [baseQueue, termFilter]);
  const filteredQueue = useMemo(() => applyQueueFilter(termFiltered, filter), [termFiltered, filter]);
  const myFiltered = useMemo(() => applyQueueFilter(filterByTerm(myActioned, termFilter), { ...filter, status: 'ALL' }), [myActioned, termFilter, filter]);

  const canActOn = (status: string) => status === 'SUBMITTED';

  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };
  const actionable = filteredQueue.filter(d => canActOn(d.status));
  const allSelected = actionable.length > 0 && selected.size === actionable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionable.map(d => d.id)));

  const handleBulk = async (status: 'HOD_APPROVED' | 'REJECTED', reason?: string) => {
    const ids = Array.from(selected);
    const res = await bulkUpdate.mutateAsync({ docIds: ids, status, rejectionReason: reason });
    setSelected(new Set());
    toast({
      title: status === 'REJECTED' ? 'Bulk reject complete' : 'Bulk approve complete',
      description: `${res.succeeded} succeeded, ${res.failed} failed${res.firstErrorMessage ? ` — ${res.firstErrorMessage}` : ''}`,
      variant: res.failed > 0 ? 'destructive' : 'default',
    });
  };

  const handleApprove = async (docId: string) => {
    const doc = filteredQueue.find(d => d.id === docId);
    if (!doc) return;
    const { data: profile } = await supabase
      .from('profiles').select('signature_url, stamp_url').eq('user_id', currentUser!.id).single();
    if (!profile?.signature_url || !profile?.stamp_url) {
      toast({ title: 'Setup required', description: 'Upload your signature & stamp in Profile Settings first.', variant: 'destructive' });
      return;
    }
    try {
      const pdfUrl = await getCachedSignedUrl(doc.signed_file_url || doc.file_url || '');
      setPlacementDoc({ id: docId, pdfUrl, sigUrl: profile.signature_url, stampUrl: profile.stamp_url });
    } catch (e) {
      toast({ title: 'Cannot open document', description: e instanceof Error ? e.message : 'Could not load PDF', variant: 'destructive' });
    }
  };

  const performApproveWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    const docId = placementDoc.id;
    updateStatus.mutate({ docId, status: 'HOD_APPROVED', placement }, {
      onSuccess: () => toast({ title: 'Document Approved', description: 'Forwarded to DP Academics.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleQuickApprove = (docId: string) => {
    updateStatus.mutate({ docId, status: 'HOD_APPROVED', mode: 'TEXT_ONLY' }, {
      onSuccess: () => toast({ title: 'Verified by HOD', description: 'Quick-verified and forwarded to DP Academics.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleReject = (docId: string) => {
    updateStatus.mutate({ docId, status: 'REJECTED', rejectionReason: 'Needs revision' }, {
      onSuccess: () => toast({ title: 'Document Rejected', variant: 'destructive' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="Department Queue" subtitle={`${currentUser?.department || ''} • ${filteredQueue.length} document(s)`} />
      <div className="mb-3 flex justify-end">
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>
      <Tabs defaultValue="queue">
        <TabsList className="w-full mb-3">
          <TabsTrigger value="queue" className="flex-1">Queue ({filteredQueue.length})</TabsTrigger>
          <TabsTrigger value="mine" className="flex-1">Approved by me ({myFiltered.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <QueueFilterBar value={filter} onChange={setFilter} docs={baseQueue} />
          <BulkActionBar
            selectedCount={selected.size}
            totalCount={actionable.length}
            isAllSelected={allSelected}
            onToggleAll={toggleAll}
            onClear={() => setSelected(new Set())}
            approveStatus="HOD_APPROVED"
            approveLabel="Approve all"
            onBulkAction={(s, r) => handleBulk(s as 'HOD_APPROVED' | 'REJECTED', r)}
            isPending={bulkUpdate.isPending}
          />
          <div className="space-y-3 mt-3">
            {filteredQueue.length > 0 ? (
              filteredQueue.map(doc => {
                const showActions = canActOn(doc.status);
                return (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    showTrainer
                    selectable={showActions}
                    selected={selected.has(doc.id)}
                    onSelectChange={(c) => toggleOne(doc.id, c)}
                    actions={showActions ? (
                      <>
                        <Button size="sm" onClick={() => handleQuickApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Stamps 'VERIFIED BY HOD' with name & date">
                          <Zap className="w-4 h-4" /> Quick Verify
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Place your signature & stamp on the PDF">
                          <CheckCircle2 className="w-4 h-4" /> Sign & Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleReject(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
                          <XCircle className="w-4 h-4" /> Reject
                        </Button>
                      </>
                    ) : undefined}
                  />
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No documents match the current filters</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="mine">
          <QueueFilterBar value={filter} onChange={setFilter} docs={myActioned} showStatus={false} />
          <div className="space-y-3 mt-3">
            {myFiltered.length > 0
              ? myFiltered.map((doc) => <DocumentCard key={doc.id} doc={doc} showTrainer />)
              : <p className="text-sm text-muted-foreground text-center py-8">You have not approved any documents yet</p>}
          </div>
        </TabsContent>
      </Tabs>
      {placementDoc && (
        <PlacementModal
          open={!!placementDoc}
          onOpenChange={(o) => { if (!o) setPlacementDoc(null); }}
          pdfUrl={placementDoc.pdfUrl}
          signatureUrl={placementDoc.sigUrl}
          stampUrl={placementDoc.stampUrl}
          stage="HOD"
          onConfirm={performApproveWithPlacement}
        />
      )}
    </div>
  );
}
