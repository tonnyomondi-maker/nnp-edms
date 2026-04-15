import { useState } from 'react';
import { mockDocuments } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Archive } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ArchiveScreen() {
  const [docs, setDocs] = useState(mockDocuments);

  const pending = docs.filter(d => d.status === 'DP_APPROVED');
  const archived = docs.filter(d => d.status === 'ARCHIVED');

  const handleArchive = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'ARCHIVED' as const, archivedAt: new Date().toISOString() } : d));
    toast({ title: 'Document Archived', description: 'Document moved to final repository.' });
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
          {pending.length > 0 ? (
            pending.map(doc => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                showTrainer
                actions={
                  <Button size="sm" onClick={() => handleArchive(doc.id)} className="w-full touch-target gap-1">
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
