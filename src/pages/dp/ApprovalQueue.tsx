import { useState, useMemo, useEffect } from 'react';
import { useDocumentsByStatus, useBulkUpdateDocumentStatus, useUpdateDocumentStatus, type ApprovalPlacement } from '@/hooks/useDocuments';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { BulkActionBar } from '@/components/common/BulkActionBar';
import { PlacementModal } from '@/components/common/PlacementModal';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { parseStorageRef } from '@/hooks/useSignedDocUrl';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function ApprovalQueue() {
  const { currentUser } = useAuth();
  const { data: queue, isLoading } = useDocumentsByStatus('HOD_APPROVED');
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);

  const baseDocs = useMemo(() => queue || [], [queue]);
  useEffect(() => {
    if (!termInitialized && baseDocs.length > 0) {
      setTermFilter(pickDefaultTerm(baseDocs));
      setTermInitialized(true);
    }
  }, [baseDocs, termInitialized]);
  const counts = useMemo(() => termCounts(baseDocs), [baseDocs]);
  const docs = useMemo(() => filterByTerm(baseDocs, termFilter), [baseDocs, termFilter]);

  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };
  const allSelected = docs.length > 0 && selected.size === docs.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(docs.map(d => d.id)));

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
      .from('profiles').select('signature_url, stamp_url').eq('user_id', currentUser!.id).single();
    if (!profile?.signature_url || !profile?.stamp_url) {
      toast({ title: 'Setup required', description: 'Upload your signature & stamp in Profile Settings first.', variant: 'destructive' });
      return;
    }
    const ref = parseStorageRef(doc.signed_file_url || doc.file_url || '');
    if (!ref) {
      toast({ title: 'Cannot open document', description: 'Storage reference is invalid.', variant: 'destructive' });
      return;
    }
    const { data: signed, error: signErr } = await supabase.storage
      .from(ref.bucket).createSignedUrl(ref.path, 3600);
    if (signErr || !signed?.signedUrl) {
      toast({ title: 'Cannot open document', description: signErr?.message || 'Could not load PDF', variant: 'destructive' });
      return;
    }
    setPlacementDoc({
      id: docId,
      pdfUrl: signed.signedUrl,
      sigUrl: profile.signature_url,
      stampUrl: profile.stamp_url,
    });
  };

  const performApproveWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    updateStatus.mutate({ docId: placementDoc.id, status: 'DP_APPROVED', placement }, {
      onSuccess: () => toast({ title: 'Document Approved', description: 'Forwarded to IQA for archiving.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleReject = (docId: string) => {
    updateStatus.mutate({ docId, status: 'REJECTED', rejectionReason: 'Does not meet standards' }, {
      onSuccess: () => toast({ title: 'Document Rejected', variant: 'destructive' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="DP Approval Queue" subtitle={`${docs.length} awaiting approval${termFilter !== 'ALL' ? ` (${termFilter.startsWith('M') ? 'Module ' + termFilter.slice(1) : 'Term ' + termFilter.slice(1)})` : ''}`} />
      <div className="mb-3 flex justify-end">
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>
      <BulkActionBar
        selectedCount={selected.size}
        totalCount={docs.length}
        isAllSelected={allSelected}
        onToggleAll={toggleAll}
        onClear={() => setSelected(new Set())}
        approveStatus="DP_APPROVED"
        approveLabel="Approve all"
        onBulkAction={(s, r) => handleBulk(s as 'DP_APPROVED' | 'REJECTED', r)}
        isPending={bulkUpdate.isPending}
      />
      <div className="space-y-3 mt-3">
        {docs.length > 0 ? (
          docs.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              showTrainer
              selectable
              selected={selected.has(doc.id)}
              onSelectChange={(c) => toggleOne(doc.id, c)}
              actions={
                <>
                  <Button size="sm" onClick={() => handleApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleReject(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
                    <XCircle className="w-4 h-4" /> Reject
                  </Button>
                </>
              }
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No documents awaiting approval</p>
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
    </div>
  );
}
