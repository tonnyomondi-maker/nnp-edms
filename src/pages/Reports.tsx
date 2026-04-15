import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

const DEPARTMENTS = ['Computer Science', 'Electrical Engineering', 'Business Studies', 'Mechanical Engineering', 'Hospitality'];
const ONE_TIME_DOCS = ['Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work'];

export default function Reports() {
  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)');
      if (error) throw error;
      return data;
    },
  });

  const { data: assignments } = useQuery({
    queryKey: ['assignments', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('teaching_assignments').select('*');
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allDocs = docs || [];
  const allAssignments = assignments || [];

  return (
    <div>
      <PageHeader title="Reports" subtitle="Compliance & analytics" />
      <Tabs defaultValue="compliance">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="compliance" className="flex-1">Compliance</TabsTrigger>
          <TabsTrigger value="missing" className="flex-1">Missing</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance" className="space-y-3">
          {DEPARTMENTS.map(dept => {
            const deptAssignments = allAssignments.filter(a => a.department === dept);
            const deptDocs = allDocs.filter(d => d.department === dept);
            const totalExpected = deptAssignments.length * ONE_TIME_DOCS.length;
            const submitted = deptDocs.filter(d => ONE_TIME_DOCS.includes(d.document_type)).length;
            const pct = totalExpected > 0 ? Math.round((submitted / totalExpected) * 100) : 0;

            return (
              <Card key={dept}>
                <CardContent className="p-4">
                  <div className="flex justify-between mb-2">
                    <p className="text-sm font-semibold">{dept}</p>
                    <span className="text-xs font-medium">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">{submitted}/{totalExpected} one-time docs submitted</p>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="missing" className="space-y-3">
          {allAssignments.map(a => {
            const aDocs = allDocs.filter(d => d.assignment_id === a.id);
            const missing = ONE_TIME_DOCS.filter(dt => !aDocs.some(d => d.document_type === dt));
            if (missing.length === 0) return null;
            return (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <p className="text-sm font-semibold">{a.unit_code} - {a.unit_name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{a.class_code} • {a.department}</p>
                  <div className="flex flex-wrap gap-1">
                    {missing.map(m => (
                      <span key={m} className="px-2 py-0.5 bg-destructive/10 text-destructive text-xs rounded-full">{m}</span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
