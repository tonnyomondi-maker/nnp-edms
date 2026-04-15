import { mockDocuments, mockAssignments, DEPARTMENTS, ONE_TIME_DOCS, WEEKLY_DOCS } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Reports() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Compliance & submission tracking" />
      <Tabs defaultValue="compliance">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="compliance" className="flex-1 text-xs">Compliance</TabsTrigger>
          <TabsTrigger value="missing" className="flex-1 text-xs">Missing</TabsTrigger>
          <TabsTrigger value="weekly" className="flex-1 text-xs">Weekly</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance" className="space-y-3">
          <h3 className="text-sm font-semibold">Department Compliance</h3>
          {DEPARTMENTS.map(dept => {
            const deptAssignments = mockAssignments.filter(a => a.department === dept);
            const deptDocs = mockDocuments.filter(d => d.department === dept);
            const expectedOneTime = deptAssignments.length * ONE_TIME_DOCS.length;
            const submittedOneTime = deptDocs.filter(d => d.submissionType === 'ONE_TIME').length;
            const rate = expectedOneTime > 0 ? Math.round((submittedOneTime / expectedOneTime) * 100) : 0;

            return (
              <Card key={dept}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-medium">{dept}</p>
                    <span className="text-xs font-semibold">{rate}%</span>
                  </div>
                  <Progress value={rate} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">{submittedOneTime}/{expectedOneTime} one-time docs submitted</p>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="missing" className="space-y-3">
          <h3 className="text-sm font-semibold">Missing Documents</h3>
          {mockAssignments.map(a => {
            const docs = mockDocuments.filter(d => d.assignmentId === a.id);
            const missing = ONE_TIME_DOCS.filter(dt => !docs.some(d => d.documentType === dt));
            if (missing.length === 0) return null;
            return (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <p className="text-sm font-medium">{a.unitCode} - {a.unitName}</p>
                  <p className="text-xs text-muted-foreground">{a.className}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {missing.map(m => (
                      <span key={m} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs">{m}</span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="weekly" className="space-y-3">
          <h3 className="text-sm font-semibold">Weekly Submission Tracker</h3>
          {[1, 2, 3, 4].map(week => {
            const weekDocs = mockDocuments.filter(d => d.submissionType === 'WEEKLY' && d.weekNumber === week);
            const expected = mockAssignments.length * WEEKLY_DOCS.length;
            const rate = expected > 0 ? Math.round((weekDocs.length / expected) * 100) : 0;
            return (
              <Card key={week}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-medium">Week {week}</p>
                    <span className="text-xs font-semibold">{weekDocs.length}/{expected}</span>
                  </div>
                  <Progress value={rate} className="h-2" />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
