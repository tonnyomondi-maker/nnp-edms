import { useMyAssignments } from '@/hooks/useAssignments';
import { useMyDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react';

const ONE_TIME_DOCS = ['Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work'];
const WEEKLY_DOCS = ['Session Plan', 'Class Attendance'];

export default function MyTeaching() {
  const { data: assignments, isLoading: loadingAssignments } = useMyAssignments();
  const { data: docs, isLoading: loadingDocs } = useMyDocuments();

  if (loadingAssignments || loadingDocs) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allAssignments = assignments || [];
  const allDocs = docs || [];

  return (
    <div>
      <PageHeader title="My Teaching" subtitle={`${allAssignments.length} units assigned`} />
      <div className="space-y-3">
        {allAssignments.map(a => {
          const assignmentDocs = allDocs.filter(d => d.assignment_id === a.id);
          const oneTimeDone = ONE_TIME_DOCS.filter(dt => assignmentDocs.some(d => d.document_type === dt)).length;
          const weeklyDone = WEEKLY_DOCS.filter(dt => assignmentDocs.some(d => d.document_type === dt && d.week_number === 1)).length;
          const total = ONE_TIME_DOCS.length + WEEKLY_DOCS.length;
          const completed = oneTimeDone + weeklyDone;
          const pct = total > 0 ? (completed / total) * 100 : 0;

          return (
            <Link key={a.id} to={`/teaching/${a.id}`}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{a.unit_code} - {a.unit_name}</p>
                        <p className="text-xs text-muted-foreground">{a.class_code} • {a.term} {a.academic_year}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
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
        {allAssignments.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments found</p>
        )}
      </div>
    </div>
  );
}
