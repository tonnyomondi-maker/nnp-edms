import { Document } from '@/data/mockData';
import { StatusBadge } from './StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Calendar } from 'lucide-react';

interface DocumentCardProps {
  doc: Document;
  showTrainer?: boolean;
  actions?: React.ReactNode;
}

export function DocumentCard({ doc, showTrainer = false, actions }: DocumentCardProps) {
  return (
    <Card className="animate-slide-up">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{doc.documentType}</p>
              <p className="text-xs text-muted-foreground truncate">{doc.unitCode} • {doc.className}</p>
              {showTrainer && <p className="text-xs text-muted-foreground">{doc.trainerName}</p>}
              {doc.weekNumber && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  <span>Week {doc.weekNumber}</span>
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
