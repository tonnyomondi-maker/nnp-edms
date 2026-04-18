import { useState } from 'react';
import { useDocumentsByStatus, useBulkUpdateDocumentStatus, useUpdateDocumentStatus, type ApprovalPlacement } from '@/hooks/useDocuments';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { BulkActionBar } from '@/components/common/BulkActionBar';
import { PlacementModal } from '@/components/common/PlacementModal';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Archive, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ArchiveScreen() {
  const { data: pendingDocs, isLoading: loadingPending } = useDocumentsByStatus('DP_APPROVED');
  const { data: archivedDocs, isLoading: loadingArchived } = useDocumentsByStatus('ARCHIVED');
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleArchive = (docId: string) => {
    updateStatus.mutate({ docId, status: 'ARCHIVED' }, {
      onSuccess: () => toast({ title: 'Document Archived', description: 'Document moved to final repository.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const isLoading = loadingPending || loadingArchived;
  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const pending = pendingDocs || [];
  const archived = archivedDocs || [];

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
      <PageHeader title="IQA Archive" subtitle="Final document repository" />
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
    </div>
  );
}
