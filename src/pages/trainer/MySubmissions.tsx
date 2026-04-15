import { useAuth } from '@/contexts/AuthContext';
import { mockDocuments } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function MySubmissions() {
  const { currentUser } = useAuth();
  const myDocs = mockDocuments.filter(d => d.trainerId === currentUser.id);

  const pending = myDocs.filter(d => ['SUBMITTED', 'HOD_APPROVED', 'DP_APPROVED'].includes(d.status));
  const completed = myDocs.filter(d => d.status === 'ARCHIVED');
  const rejected = myDocs.filter(d => d.status === 'REJECTED');

  return (
    <div>
      <PageHeader title="My Submissions" subtitle={`${myDocs.length} total documents`} />
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
              {d.rejectionReason && (
                <p className="text-xs text-destructive mt-1 ml-1">Reason: {d.rejectionReason}</p>
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
