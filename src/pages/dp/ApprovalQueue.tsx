import { useDocumentsByStatus, useUpdateDocumentStatus } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function ApprovalQueue() {
  const { data: queue, isLoading } = useDocumentsByStatus('HOD_APPROVED');
  const updateStatus = useUpdateDocumentStatus();

  const handleApprove = (docId: string) => {
    updateStatus.mutate({ docId, status: 'DP_APPROVED' }, {
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

  const docs = queue || [];

  return (
    <div>
      <PageHeader title="DP Approval Queue" subtitle={`${docs.length} awaiting approval`} />
      <div className="space-y-3">
        {docs.length > 0 ? (
          docs.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              showTrainer
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
    </div>
  );
}
