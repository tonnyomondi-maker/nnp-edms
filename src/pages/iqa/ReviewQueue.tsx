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
import { GroupByControl, groupDocs, GroupSection, type GroupByKey } from '@/components/common/GroupByControl';
import { BulkSignButton } from '@/components/common/BulkSignButton';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getCachedSignedUrl, resolveSignatureUrl } from '@/hooks/useSignedDocUrl';
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';

/**
 * IQAO review stage — sits between HOD verification and DP Academics approval.
 * Reviewed documents move to IQA_REVIEWED and appear in the DP queue.
 */
export default function ReviewQueue() {
  const { currentUser, activeRole } = useAuth();
  const guard = useRoleGuard();
  const canAct = activeRole === 'IQA' && !guard.writesBlocked;
  const { data: queue, isLoading } = useAllDocuments();
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [returnDocId, setReturnDocId] = useState<string | null>(null);
  const [rejectDoc, setRejectDoc] = useState<{ id: string; label: string } | null>(null);
  const [filter, setFilter] = useState<QueueFilterValue>({ ...DEFAULT_QUEUE_FILTER, status: 'HOD_APPROVED' });
  const [groupBy, setGroupBy] = useState<GroupByKey>('SESSION');

  useEffect(() => { if (!canAct) setSelected(new Set()); }, [canAct, activeRole]);

  const baseDocs = useMemo(() => queue || [], [queue]);
  const docs = useMemo(() => applyQueueFilter(baseDocs, filter), [baseDocs, filter]);
  const canActOn = (status: string) => status === 'HOD_APPROVED';
  const actionable = docs.filter((d) => canActOn(d.status));
  const allSelected = actionable.length > 0 && selected.size === actionable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionable.map((d) => d.id)));
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleBulk = async (status: 'IQA_REVIEWED' | 'REJECTED', reason?: string) => {
    const res = await bulkUpdate.mutateAsync({ docIds: Array.from(selected), status, rejectionReason: reason });
    setSelected(new Set());
    toast({
      title: status === 'REJECTED' ? 'Bulk reject complete' : 'Bulk review complete',
      description: `${res.succeeded} succeeded, ${res.failed} failed${res.firstErrorMessage ? ` — ${res.firstErrorMessage}` : ''}`,
      variant: res.failed > 0 ? 'destructive' : 'default',
    });
  };

  const handleSign = async (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;
    const { data: profile } = await supabase
      .from('profiles').select('signature_url, stamp_url, stamp_required').eq('user_id', currentUser!.id).single();
    const profAny = profile as unknown as { signature_url?: string; stamp_url?: string; stamp_required?: boolean } | null;
    if (!profAny?.signature_url) {
      toast({ title: 'Setup required', description: 'Add a signature in Profile Settings first.', variant: 'destructive' });
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

  const performWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    updateStatus.mutate({ docId: placementDoc.id, status: 'IQA_REVIEWED', placement }, {
      onSuccess: () => {
        setPlacementDoc(null);
        toast({ title: 'Reviewed by IQAO', description: 'Signed on the approval sheet (slot 2). Forwarded to Deputy Principal — Academics for approval.' });
      },
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleQuickReview = (docId: string) => {
    updateStatus.mutate({ docId, status: 'IQA_REVIEWED', mode: 'TEXT_ONLY' }, {
      onSuccess: () => toast({ title: 'Reviewed by IQAO', description: 'Forwarded to Deputy Principal — Academics for approval.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const confirmReject = async (reason: string) => {
    if (!rejectDoc) return;
    await updateStatus.mutateAsync({ docId: rejectDoc.id, status: 'REJECTED', rejectionReason: reason });
    setRejectDoc(null);
    toast({ title: 'Document rejected', description: 'Comment sent to the trainer.', variant: 'destructive' });
  };

  type QueueDoc = (typeof docs)[number];
  const renderDoc = (doc: QueueDoc) => {
    const showActions = canActOn(doc.status) && canAct;
    return (
      <DocumentCard
        key={doc.id}
        doc={doc}
        showTrainer
        selectable={showActions}
        selected={selected.has(doc.id)}
        onSelectChange={(c) => toggleOne(doc.id, c)}
        showAiReview={showActions}
        onReturnRequest={showActions ? () => setReturnDocId(doc.id) : undefined}
        actions={showActions ? (
          <>
            <ActionGuardButton action="approve" doc={doc} size="sm" onClick={() => handleQuickReview(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Stamps 'REVIEWED BY IQA' with name & date">
              <Zap className="w-4 h-4" /> Quick Review
            </ActionGuardButton>
            <ActionGuardButton action="approve" doc={doc} size="sm" variant="outline" onClick={() => handleSign(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Place your signature & stamp on the PDF">
              <CheckCircle2 className="w-4 h-4" /> Sign & Review
            </ActionGuardButton>
            <ActionGuardButton action="reject" doc={doc} size="sm" variant="destructive" onClick={() => setRejectDoc({ id: doc.id, label: `${doc.document_type}${doc.unit_code ? ' • ' + doc.unit_code : ''}` })} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
              <XCircle className="w-4 h-4" /> Reject
            </ActionGuardButton>
          </>
        ) : undefined}
      />
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }


  return (
    <div>
      <PageHeader title="IQAO Review Queue" subtitle={`${actionable.length} document(s) awaiting quality review`} />
      <TemplateLibraryPanel />

      {!canAct && (
        <div className="mb-3 p-2 rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-100">
          You are viewing as <strong>{activeRole}</strong>. Switch to <strong>IQAO</strong> to review documents.
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <GroupByControl value={groupBy} onChange={setGroupBy} />
      </div>
      <QueueFilterBar value={filter} onChange={setFilter} docs={baseDocs} />
      <BulkActionBar
        selectedCount={selected.size}
        totalCount={actionable.length}
        isAllSelected={allSelected}
        onToggleAll={toggleAll}
        onClear={() => setSelected(new Set())}
        approveStatus="IQA_REVIEWED"
        approveLabel="Mark reviewed"
        onBulkAction={(s, r) => handleBulk(s as 'IQA_REVIEWED' | 'REJECTED', r)}
        isPending={bulkUpdate.isPending}
      />
      {canAct && selected.size > 0 && (
        <div className="mt-2 flex justify-end">
          <BulkSignButton
            docs={actionable.filter((d) => selected.has(d.id))}
            status="IQA_REVIEWED"
            stage="IQA_REVIEW"
            label="Sign & review selected"
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}

      <div className="space-y-3 mt-3">
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No documents match the current filters</p>
        ) : groupBy === 'HIERARCHY' ? (
          <HierarchyView
            docs={docs}
            levels={hierarchyFor('IQA')}
            pendingOf={(d) => canActOn(d.status)}
            renderDoc={renderDoc}
          />
        ) : (
          groupDocs(docs, groupBy).map((group) => (
            <GroupSection key={group.key} label={group.label} count={group.docs.length}>
              {group.docs.map((doc) => renderDoc(doc))}
            </GroupSection>
          ))
        )}
      </div>


      {placementDoc && (
        <PlacementModal
          open={!!placementDoc}
          onOpenChange={(o) => { if (!o) setPlacementDoc(null); }}
          pdfUrl={placementDoc.pdfUrl}
          signatureUrl={placementDoc.sigUrl}
          stampUrl={placementDoc.stampUrl}
          stage="IQA_REVIEW"
          busy={updateStatus.isPending}
          onConfirm={performWithPlacement}
        />
      )}
      {returnDocId && (
        <ReturnStageDialog open={!!returnDocId} onOpenChange={(o) => { if (!o) setReturnDocId(null); }} docId={returnDocId} fromStage="IQA_REVIEW" />
      )}
      {rejectDoc && (
        <RejectDialog
          open={!!rejectDoc}
          onOpenChange={(o) => { if (!o) setRejectDoc(null); }}
          docLabel={rejectDoc.label}
          stage="IQA"
          onConfirm={confirmReject}
          isPending={updateStatus.isPending}
        />
      )}
    </div>
  );
}
