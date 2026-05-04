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
import { Archive, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ArchiveScreen() {
  const { currentUser } = useAuth();
  const { data: pendingDocs, isLoading: loadingPending } = useDocumentsByStatus('DP_APPROVED');
  const { data: archivedDocs, isLoading: loadingArchived } = useDocumentsByStatus('ARCHIVED');
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);

  const handleArchive = async (docId: string) => {
    const doc = (pendingDocs || []).find(d => d.id === docId);
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

  const performArchiveWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    updateStatus.mutate({ docId: placementDoc.id, status: 'ARCHIVED', placement }, {
      onSuccess: () => toast({ title: 'Document Archived', description: 'Document moved to final repository.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const isLoading = loadingPending || loadingArchived;
  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allPending = pendingDocs || [];
  const allArchived = archivedDocs || [];

  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);

  useEffect(() => {
    if (!termInitialized && allPending.length > 0) {
      setTermFilter(pickDefaultTerm(allPending));
      setTermInitialized(true);
    }
  }, [allPending, termInitialized]);

  const counts = useMemo(
    () => termCounts([...allPending, ...allArchived]),
    [allPending, allArchived],
  );
  const pending = useMemo(() => filterByTerm(allPending, termFilter), [allPending, termFilter]);
  const archived = useMemo(() => filterByTerm(allArchived, termFilter), [allArchived, termFilter]);

  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };
  const allSelected = pending.length > 0 && selected.size === pending.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pending.map(d => d.id)));

  const handleBulk = async (status: 'ARCHIVED' | 'REJECTED', reason?: string) => {
    const ids = Array.from(selected);
    const res = await bulkUpdate.mutateAsync({ docIds: ids, status, rejectionReason: reason });
    setSelected(new Set());
    toast({
      title: 'Bulk archive complete',
      description: `${res.succeeded} succeeded, ${res.failed} failed${res.firstErrorMessage ? ` — ${res.firstErrorMessage}` : ''}`,
      variant: res.failed > 0 ? 'destructive' : 'default',
    });
  };

  return (
    <div>
      <PageHeader title="IQA Archive" subtitle={`Final document repository${termFilter !== 'ALL' ? ` • ${termFilter.startsWith('M') ? 'Module ' + termFilter.slice(1) : 'Term ' + termFilter.slice(1)}` : ''}`} />
      <div className="mb-3 flex justify-end">
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>
      <Tabs defaultValue="pending">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="pending" className="flex-1">To Archive ({pending.length})</TabsTrigger>
          <TabsTrigger value="archived" className="flex-1">Archived ({archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-3">
          <BulkActionBar
            selectedCount={selected.size}
            totalCount={pending.length}
            isAllSelected={allSelected}
            onToggleAll={toggleAll}
            onClear={() => setSelected(new Set())}
            approveStatus="ARCHIVED"
            approveLabel="Archive all"
            showReject={false}
            onBulkAction={(s, r) => handleBulk(s as 'ARCHIVED' | 'REJECTED', r)}
            isPending={bulkUpdate.isPending}
          />
          {pending.length > 0 ? (
            pending.map(doc => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                showTrainer
                selectable
                selected={selected.has(doc.id)}
                onSelectChange={(c) => toggleOne(doc.id, c)}
                actions={
                  <Button size="sm" onClick={() => handleArchive(doc.id)} disabled={updateStatus.isPending} className="w-full touch-target gap-1">
                    <Archive className="w-4 h-4" /> Archive
                  </Button>
                }
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No documents pending archive</p>
          )}
        </TabsContent>
        <TabsContent value="archived" className="space-y-3">
          {archived.length > 0 ? (
            archived.map(doc => <DocumentCard key={doc.id} doc={doc} showTrainer />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No archived documents</p>
          )}
        </TabsContent>
      </Tabs>
      {placementDoc && (
        <PlacementModal
          open={!!placementDoc}
          onOpenChange={(o) => { if (!o) setPlacementDoc(null); }}
          pdfUrl={placementDoc.pdfUrl}
          signatureUrl={placementDoc.sigUrl}
          stampUrl={placementDoc.stampUrl}
          stage="IQA"
          onConfirm={performArchiveWithPlacement}
        />
      )}
    </div>
  );
}
