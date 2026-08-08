import { useState, useMemo, useEffect } from 'react';
import { useAllDocuments, useBulkUpdateDocumentStatus, useUpdateDocumentStatus, type ApprovalPlacement } from '@/hooks/useDocuments';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { TemplateLibraryPanel } from '@/components/common/TemplateLibraryPanel';

import { DocumentCard } from '@/components/common/DocumentCard';
import { BulkActionBar } from '@/components/common/BulkActionBar';
import { PlacementModal } from '@/components/common/PlacementModal';
import { ReturnStageDialog } from '@/components/common/ReturnStageDialog';
import { RejectDialog } from '@/components/common/RejectDialog';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { GroupByControl, groupDocs, GroupSection, type GroupByKey } from '@/components/common/GroupByControl';
import { BulkSignButton } from '@/components/common/BulkSignButton';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { Button } from '@/components/ui/button';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getCachedSignedUrl, resolveSignatureUrl } from '@/hooks/useSignedDocUrl';
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';


export default function ApprovalQueue() {
  const { currentUser, activeRole } = useAuth();
  const guard = useRoleGuard();
  const canAct = guard.canApproveAsDP();
  const { data: queue, isLoading } = useAllDocuments();
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [returnDocId, setReturnDocId] = useState<string | null>(null);
  const [rejectDoc, setRejectDoc] = useState<{ id: string; label: string } | null>(null);
  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);
  const [filter, setFilter] = useState<QueueFilterValue>({ ...DEFAULT_QUEUE_FILTER, status: 'IQA_REVIEWED' });
  const [groupBy, setGroupBy] = useState<GroupByKey>('STAGE');


  const baseDocs = useMemo(() => queue || [], [queue]);
  useEffect(() => {
    if (!termInitialized && baseDocs.length > 0) {
      setTermFilter(pickDefaultTerm(baseDocs));
      setTermInitialized(true);
    }
  }, [baseDocs, termInitialized]);
  const counts = useMemo(() => termCounts(baseDocs), [baseDocs]);
  const termFiltered = useMemo(() => filterByTerm(baseDocs, termFilter), [baseDocs, termFilter]);
  const docs = useMemo(() => applyQueueFilter(termFiltered, filter), [termFiltered, filter]);
  const canActOn = (status: string) => status === 'IQA_REVIEWED';

  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };
  const actionable = docs.filter(d => canActOn(d.status));
  const allSelected = actionable.length > 0 && selected.size === actionable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionable.map(d => d.id)));

  const handleBulk = async (status: 'DP_APPROVED' | 'REJECTED', reason?: string) => {
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
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;
    const { data: profile } = await supabase
      .from('profiles').select('signature_url, stamp_url, stamp_required').eq('user_id', currentUser!.id).single();
    const profAny = profile as unknown as { signature_url?: string; stamp_url?: string; stamp_required?: boolean } | null;
    if (!profAny?.signature_url) {
      toast({ title: 'Setup required', description: 'Add a signature (upload, draw or type one) in Profile Settings first.', variant: 'destructive' });
      return;
    }
    if (profAny.stamp_required !== false && !profAny.stamp_url) {
      toast({ title: 'Stamp required', description: 'Upload a stamp in Profile Settings, or turn off "Stamp required" to sign without one.', variant: 'destructive' });
      return;
    }
    try {
      const [pdfUrl, sigUrl, stampUrl] = await Promise.all([
        getCachedSignedUrl(doc.signed_file_url || doc.file_url || ''),
        resolveSignatureUrl(profAny.signature_url),
        resolveSignatureUrl(profAny.stamp_url),
      ]);
      setPlacementDoc({ id: docId, pdfUrl, sigUrl, stampUrl });
    } catch (e) {
      toast({ title: 'Cannot open document', description: e instanceof Error ? e.message : 'Could not load PDF', variant: 'destructive' });
    }
  };

  const performApproveWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    updateStatus.mutate({ docId: placementDoc.id, status: 'DP_APPROVED', placement }, {
      onSuccess: () => {
        setPlacementDoc(null);
        toast({ title: 'Approved by Deputy Principal — Academics', description: 'Signed on the approval sheet (slot 3). Returned to IQAO for archiving.' });
      },
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleQuickApprove = (docId: string) => {
    updateStatus.mutate({ docId, status: 'DP_APPROVED', mode: 'TEXT_ONLY' }, {
      onSuccess: () => toast({ title: 'Approved by Deputy Principal — Academics', description: 'Returned to IQAO for archiving.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const openReject = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    setRejectDoc({ id: docId, label: doc ? `${doc.document_type}${doc.unit_code ? ' • ' + doc.unit_code : ''}` : '' });
  };
  const confirmReject = async (reason: string) => {
    if (!rejectDoc) return;
    await updateStatus.mutateAsync({ docId: rejectDoc.id, status: 'REJECTED', rejectionReason: reason });
    setRejectDoc(null);
    toast({ title: 'Document Rejected', description: 'Comment sent to trainer for revision.', variant: 'destructive' });
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="DP Approval Queue" subtitle={`${docs.length} document(s)`} />
      <TemplateLibraryPanel />

      {!canAct && (
        <div className="mb-3 p-2 rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-100">
          You are viewing as <strong>{activeRole}</strong>. Switch to <strong>DP Academics</strong> in the top bar to approve documents.
        </div>
      )}
      <div className="mb-3 flex justify-end gap-2">
        <GroupByControl value={groupBy} onChange={setGroupBy} />
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>
      <QueueFilterBar value={filter} onChange={setFilter} docs={baseDocs} />
      <BulkActionBar
        selectedCount={selected.size}
        totalCount={actionable.length}
        isAllSelected={allSelected}
        onToggleAll={toggleAll}
        onClear={() => setSelected(new Set())}
        approveStatus="DP_APPROVED"
        approveLabel="Approve all"
        onBulkAction={(s, r) => handleBulk(s as 'DP_APPROVED' | 'REJECTED', r)}
        isPending={bulkUpdate.isPending}
      />
      {canAct && selected.size > 0 && (
        <div className="mt-2 flex justify-end">
          <BulkSignButton
            docs={actionable.filter((d) => selected.has(d.id))}
            status="DP_APPROVED"
            stage="DP"
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}
      <div className="space-y-3 mt-3">
        {docs.length > 0 ? (
          groupDocs(docs, groupBy).map((group) => (
            <GroupSection key={group.key} label={group.label} count={group.docs.length}>
              {group.docs.map(doc => {
                const showActions = canActOn(doc.status) && canAct;
                return (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    showTrainer
                    selectable={showActions}
                    selected={selected.has(doc.id)}
                    onSelectChange={(c) => toggleOne(doc.id, c)}
                    showAiReview={canAct && doc.status === 'IQA_REVIEWED'}
                    onReturnRequest={canAct && doc.status === 'IQA_REVIEWED' ? () => setReturnDocId(doc.id) : undefined}
                    actions={showActions ? (
                      <>
                        <ActionGuardButton action="approve" doc={doc} size="sm" onClick={() => handleQuickApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Stamps 'APPROVED BY DP ACADEMICS' with name & date">
                          <Zap className="w-4 h-4" /> Quick Approve
                        </ActionGuardButton>
                        <ActionGuardButton action="approve" doc={doc} size="sm" variant="outline" onClick={() => handleApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Place your signature & stamp on the PDF">
                          <CheckCircle2 className="w-4 h-4" /> Sign & Approve
                        </ActionGuardButton>
                        <ActionGuardButton action="reject" doc={doc} size="sm" variant="destructive" onClick={() => openReject(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
                          <XCircle className="w-4 h-4" /> Reject
                        </ActionGuardButton>
                      </>
                    ) : undefined}
                  />
                );
              })}
            </GroupSection>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No documents match the current filters</p>
        )}
      </div>
      {placementDoc && (
        <PlacementModal
          open={!!placementDoc}
          onOpenChange={(o) => { if (!o) setPlacementDoc(null); }}
          pdfUrl={placementDoc.pdfUrl}
          signatureUrl={placementDoc.sigUrl}
          stampUrl={placementDoc.stampUrl}
          stage="DP"
          onConfirm={performApproveWithPlacement}
        />
      )}
      {returnDocId && (
        <ReturnStageDialog open={!!returnDocId} onOpenChange={(o) => { if (!o) setReturnDocId(null); }} docId={returnDocId} fromStage="DP" />
      )}
      {rejectDoc && (
        <RejectDialog
          open={!!rejectDoc}
          onOpenChange={(o) => { if (!o) setRejectDoc(null); }}
          docLabel={rejectDoc.label}
          stage="DP"
          onConfirm={confirmReject}
          isPending={updateStatus.isPending}
        />
      )}
    </div>
  );
}

