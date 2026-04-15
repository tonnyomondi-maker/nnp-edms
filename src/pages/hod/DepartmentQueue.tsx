import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mockDocuments } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function DepartmentQueue() {
  const { currentUser } = useAuth();
  const [docs, setDocs] = useState(mockDocuments);

  // HOD sees SUBMITTED docs in their department, excluding their own
  const queue = docs.filter(
    d => d.status === 'SUBMITTED' && d.department === currentUser.department && d.trainerId !== currentUser.id
  );

  const handleApprove = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'HOD_APPROVED' as const, hodApprovedAt: new Date().toISOString() } : d));
    toast({ title: 'Document Approved', description: 'Forwarded to DP Academics.' });
  };

  const handleReject = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'REJECTED' as const, rejectionReason: 'Needs revision' } : d));
    toast({ title: 'Document Rejected', description: 'Trainer has been notified.', variant: 'destructive' });
  };

  return (
    <div>
      <PageHeader title="Department Queue" subtitle={`${currentUser.department} • ${queue.length} pending`} />
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
          <p className="text-sm text-muted-foreground text-center py-8">No documents awaiting review</p>
        )}
      </div>
    </div>
  );
}
