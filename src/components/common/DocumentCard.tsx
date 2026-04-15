import { Tables } from '@/integrations/supabase/types';
import { StatusBadge } from './StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Calendar } from 'lucide-react';

type DocumentRow = Tables<'documents'>;

interface DocumentCardProps {
  doc: DocumentRow & { teaching_assignments?: Tables<'teaching_assignments'> | null };
  showTrainer?: boolean;
  actions?: React.ReactNode;
}

export function DocumentCard({ doc, showTrainer = false, actions }: DocumentCardProps) {
  const unitCode = doc.teaching_assignments?.unit_code || '';
  const className = doc.teaching_assignments?.class_code || '';

  return (
    <Card className="animate-slide-up">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{doc.document_type}</p>
              <p className="text-xs text-muted-foreground truncate">{unitCode} • {className}</p>
              {doc.week_number && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  <span>Week {doc.week_number}</span>
                </div>
              )}
            </div>
          </div>
          <StatusBadge status={doc.status} />
        </div>
        {actions && <div className="mt-3 flex gap-2">{actions}</div>}
      </CardContent>
    </Card>
  );
}
