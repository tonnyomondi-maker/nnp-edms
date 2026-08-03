import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useCourses, useUpsertCourse, useDeleteCourse } from '@/hooks/useCourses';
import { DEPARTMENTS } from '@/lib/sessions';
import { toast } from '@/hooks/use-toast';
import { GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react';

/**
 * Courses sit between a department and the units trainers key in.
 * Super Admin manages every department; a HOD manages only their own.
 */
export default function Courses() {
  const { currentUser, activeRole } = useAuth();
  const isHodScoped = activeRole === 'HOD';
  const defaultDept = isHodScoped ? (currentUser?.department || '') : '';

  const [department, setDepartment] = useState(defaultDept);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [filterDept, setFilterDept] = useState<string>(defaultDept || 'ALL');

  const { data: courses = [], isLoading } = useCourses(filterDept === 'ALL' ? null : filterDept);
  const upsert = useUpsertCourse();
  const del = useDeleteCourse();

  const grouped = useMemo(() => {
    const m = new Map<string, typeof courses>();
    courses.forEach((c) => {
      const list = m.get(c.department) || [];
      list.push(c);
      m.set(c.department, list);
    });
    return Array.from(m.entries());
  }, [courses]);

  const save = async () => {
    if (!department || !code.trim() || !name.trim()) {
      toast({ title: 'Missing details', description: 'Department, course code and course name are required.', variant: 'destructive' });
      return;
    }
    try {
      await upsert.mutateAsync({ department, code: code.trim(), name: name.trim() });
      setCode(''); setName('');
      toast({ title: 'Course saved' });
    } catch (e) {
      toast({ title: 'Could not save course', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="pb-8">
      <PageHeader title="Courses" subtitle="Department → course → unit. Trainers pick a course when keying in their units." />

      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-sm">Department</Label>
              <Select value={department} onValueChange={setDepartment} disabled={isHodScoped}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {(isHodScoped && currentUser?.department ? [currentUser.department] : DEPARTMENTS).map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Course code</Label>
              <Input className="mt-1.5" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DICT" />
            </div>
            <div>
              <Label className="text-sm">Course name</Label>
              <Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diploma in ICT" />
            </div>
          </div>
          <Button size="sm" onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            Save course
          </Button>
        </CardContent>
      </Card>

      {!isHodScoped && (
        <div className="mb-3 flex justify-end">
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-[260px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No courses yet.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([dept, list]) => (
            <Card key={dept}>
              <CardContent className="p-3">
                <p className="text-xs font-semibold flex items-center gap-2 mb-2">
                  <GraduationCap className="w-4 h-4 text-primary" /> {dept}
                  <Badge variant="secondary">{list.length}</Badge>
                </p>
                <div className="space-y-1">
                  {list.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 border rounded p-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{c.code} — {c.name}</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => del.mutate(c.id)} aria-label="Delete course">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
