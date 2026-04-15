import { useAuth } from '@/contexts/AuthContext';
import { mockAssignments, mockDocuments, ONE_TIME_DOCS, WEEKLY_DOCS, getDocCompletionForAssignment } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight } from 'lucide-react';

export default function MyTeaching() {
  const { currentUser } = useAuth();
  const assignments = mockAssignments.filter(a => a.trainerId === currentUser.id);

  return (
    <div>
      <PageHeader title="My Teaching" subtitle={`${assignments.length} units assigned`} />
      <div className="space-y-3">
        {assignments.map(a => {
          const { total, completed } = getDocCompletionForAssignment(a.id, mockDocuments);
          const pct = Math.round((completed / total) * 100);
          return (
            <Link key={a.id} to={`/teaching/${a.id}`}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{a.unitCode} - {a.unitName}</p>
                        <p className="text-xs text-muted-foreground">{a.className} • {a.term} {a.year}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Documents</span>
                      <span className="font-medium">{completed}/{total}</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
