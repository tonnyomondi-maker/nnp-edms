import { useDocumentsByStatus, useUpdateDocumentStatus } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Archive, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ArchiveScreen() {
  const { data: pendingDocs, isLoading: loadingPending } = useDocumentsByStatus('DP_APPROVED');
  const { data: archivedDocs, isLoading: loadingArchived } = useDocumentsByStatus('ARCHIVED');
  const updateStatus = useUpdateDocumentStatus();

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

  return (
    <div>
      <PageHeader title="IQA Archive" subtitle="Final document repository" />
      <Tabs defaultValue="pending">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="pending" className="flex-1">To Archive ({pending.length})</TabsTrigger>
          <TabsTrigger value="archived" className="flex-1">Archived ({archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-3">
          {pending.length > 0 ? (
            pending.map(doc => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                showTrainer
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
