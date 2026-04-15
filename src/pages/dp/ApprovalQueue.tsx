import { useState } from 'react';
import { mockDocuments } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function ApprovalQueue() {
  const [docs, setDocs] = useState(mockDocuments);

  const queue = docs.filter(d => d.status === 'HOD_APPROVED');

  const handleApprove = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'DP_APPROVED' as const, dpApprovedAt: new Date().toISOString() } : d));
    toast({ title: 'Document Approved', description: 'Forwarded to IQA for archiving.' });
  };

  const handleReject = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'REJECTED' as const, rejectionReason: 'Does not meet standards' } : d));
    toast({ title: 'Document Rejected', variant: 'destructive' });
  };

  return (
    <div>
      <PageHeader title="DP Approval Queue" subtitle={`${queue.length} awaiting approval`} />
      <div className="space-y-3">
        {queue.length > 0 ? (
          queue.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              showTrainer
              actions={
                <>
                  <Button size="sm" onClick={() => handleApprove(doc.id)} className="flex-1 touch-target gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleReject(doc.id)} className="flex-1 touch-target gap-1">
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
