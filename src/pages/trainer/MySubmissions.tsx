import { useAuth } from '@/contexts/AuthContext';
import { useMyDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

export default function MySubmissions() {
  const { data: docs, isLoading } = useMyDocuments();

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allDocs = docs || [];
  const pending = allDocs.filter(d => ['SUBMITTED', 'HOD_APPROVED', 'DP_APPROVED'].includes(d.status));
  const completed = allDocs.filter(d => d.status === 'ARCHIVED');
  const rejected = allDocs.filter(d => d.status === 'REJECTED');

  return (
    <div>
      <PageHeader title="My Submissions" subtitle={`${allDocs.length} total documents`} />
      <Tabs defaultValue="pending">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="pending" className="flex-1">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="rejected" className="flex-1">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-3">
          {pending.length > 0 ? pending.map(d => <DocumentCard key={d.id} doc={d} />) : <EmptyState text="No pending documents" />}
        </TabsContent>
        <TabsContent value="completed" className="space-y-3">
          {completed.length > 0 ? completed.map(d => <DocumentCard key={d.id} doc={d} />) : <EmptyState text="No completed documents" />}
        </TabsContent>
        <TabsContent value="rejected" className="space-y-3">
          {rejected.map(d => (
            <div key={d.id}>
              <DocumentCard doc={d} />
              {d.rejection_reason && (
                <p className="text-xs text-destructive mt-1 ml-1">Reason: {d.rejection_reason}</p>
              )}
            </div>
          ))}
          {rejected.length === 0 && <EmptyState text="No rejected documents" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
