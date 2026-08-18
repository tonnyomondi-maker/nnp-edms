import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { unitCoverage, type ReportDoc } from '@/lib/reportMetrics';
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Loader2, Paperclip, Plus, Save, Upload } from 'lucide-react';

import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useMyDocumentsBySession } from '@/hooks/useDocuments';
import { useMyUnitConfigs, useUpsertUnitConfig } from '@/hooks/useUnitSessionConfig';
import { useCourses } from '@/hooks/useCourses';
import { useCurrentSession } from '@/hooks/useAcademicSession';
import {
  DEPARTMENTS,
  ONE_TIME_DOC_TYPES,
  WEEKLY_DOC_TYPES,
  SESSION_LEVEL_DOC_TYPES,
  COURSE_TYPES,
  MODULE_NUMBERS,
  getCurrentSession,
  getSessionOptions,
  sessionLabel,
  type SessionTerm,
  type CourseType,
} from '@/lib/sessions';

export default function MyTeaching() {
  const { currentUser } = useAuth();
  const current = getCurrentSession();
  const sessionOptions = useMemo(() => getSessionOptions(), []);
  const { data: adminSession } = useCurrentSession();
  const [year, setYear] = useState<number>(current.year);
  const [term, setTerm] = useState<SessionTerm>(current.term);

  useEffect(() => {
    if (!adminSession) return;
    setYear(adminSession.session_year);
    setTerm(adminSession.session_term as SessionTerm);
  }, [adminSession]);

  const { data: docs, isLoading } = useMyDocumentsBySession(year, term);
  const { data: configs = [] } = useMyUnitConfigs(year, term);
  const upsertConfig = useUpsertUnitConfig();

  // --- Add / edit a unit (course-linked) ---
  const [showForm, setShowForm] = useState(false);
  const [department, setDepartment] = useState(currentUser?.department || '');
  const [courseId, setCourseId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [sessionsPerWeek, setSessionsPerWeek] = useState(1);
  const [courseType, setCourseType] = useState<CourseType>('CYCLE');
  const [termNumber, setTermNumber] = useState(1);
  const [moduleNumber, setModuleNumber] = useState(1);

  const { data: courses = [] } = useCourses(department || null);

  useEffect(() => {
    if (!department && currentUser?.department) setDepartment(currentUser.department);
  }, [currentUser?.department, department]);

  const resetForm = () => {
    setCourseId('');
    setUnitCode('');
    setUnitName('');
    setClassCode('');
    setSessionsPerWeek(1);
    setCourseType('CYCLE');
    setTermNumber(1);
    setModuleNumber(1);
  };

  const saveUnit = async () => {
    if (!department || !courseId || !unitCode.trim() || !unitName.trim() || !classCode.trim()) {
      toast({ title: 'Missing details', description: 'Department, course, unit code, unit name and class code are all required.', variant: 'destructive' });
      return;
    }
    try {
      await upsertConfig.mutateAsync({
        department,
        course_id: courseId,
        unit_code: unitCode.trim(),
        unit_name: unitName.trim(),
        class_code: classCode.trim(),
        session_year: year,
        session_term: term,
        sessions_per_week: sessionsPerWeek,
        course_type: courseType,
        term_number: courseType === 'MODULAR' ? null : termNumber,
        module_number: courseType === 'MODULAR' ? moduleNumber : null,
      });
      toast({ title: 'Unit saved', description: `${unitCode} is now available in the Upload tab.` });
      resetForm();
      setShowForm(false);
    } catch (e) {
      toast({ title: 'Could not save unit', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allDocs = (docs || []) as unknown as Array<Record<string, unknown> & {
    id: string;
    document_type: string;
    week_number: number | null;
  }>;

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name || null;

  const unitMap = new Map<string, {
    unit_code: string;
    unit_name: string;
    class_code: string;
    sessionsPerWeek: number;
    termNumber: number | null;
    course_id: string | null;
    docs: typeof allDocs;
  }>();

  configs.forEach((c) => {
    unitMap.set(c.unit_code, {
      unit_code: c.unit_code,
      unit_name: c.unit_name || '',
      class_code: c.class_code || '',
      sessionsPerWeek: c.sessions_per_week,
      termNumber: c.term_number,
      course_id: c.course_id ?? null,
      docs: [],
    });
  });

  allDocs.forEach((d) => {
    const code = (d.unit_code as string) || 'Unknown';
    if (!unitMap.has(code)) {
      unitMap.set(code, {
        unit_code: code,
        unit_name: (d.unit_name as string) || '',
        class_code: (d.class_code as string) || '',
        sessionsPerWeek: (d.sessions_per_week as number) || 1,
        termNumber: (d.term_number as number) ?? null,
        course_id: (d.course_id as string) ?? null,
        docs: [],
      });
    }
    unitMap.get(code)!.docs.push(d);
  });

  const units = Array.from(unitMap.values()).sort((a, b) => a.unit_code.localeCompare(b.unit_code));

  return (
    <div className="pb-8">
      <PageHeader title="My Teaching" subtitle={`${sessionLabel(year, term)} • ${units.length} unit(s)`} />

      <div className="flex items-center gap-3 mb-4">
        {adminSession ? (
          <div className="flex-1 rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-sm font-semibold">{sessionLabel(year, term)}</p>
            <p className="text-[11px] text-muted-foreground">Open training session set by the administrator.</p>
          </div>
        ) : (
          <Select
            value={`${year}_${term}`}
            onValueChange={(v) => {
              setYear(Number(v.split('_')[0]));
              setTerm(v.substring(v.indexOf('_') + 1) as SessionTerm);
            }}
          >
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sessionOptions.map((o) => (
                <SelectItem key={`${o.year}_${o.term}`} value={`${o.year}_${o.term}`}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          <Plus className="w-4 h-4 mr-1" /> Add unit
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Manage the units you teach and complete the documents attached to each unit. Start uploads from the specific document action so the system carries the unit details forward automatically.
      </p>

      {showForm && (
        <Card className="mb-4">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Department</Label>
                <Select value={department} onValueChange={(v) => { setDepartment(v); setCourseId(''); }}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Course</Label>
                <Select value={courseId} onValueChange={setCourseId} disabled={!department}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={department ? 'Select course' : 'Pick a department first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.filter((c) => c.active).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {department && courses.length === 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                    No courses set up for this department yet — ask the administrator to add them.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm font-medium">Unit Code</Label>
                <Input className="mt-1.5" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="e.g. ICT/CU/CS/CR/01/6" />
              </div>
              <div>
                <Label className="text-sm font-medium">Unit Name</Label>
                <Input className="mt-1.5" value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. Computer Networks" />
              </div>
              <div>
                <Label className="text-sm font-medium">Class Code</Label>
                <Input className="mt-1.5" value={classCode} onChange={(e) => setClassCode(e.target.value)} placeholder="e.g. DICT 2A" />
              </div>
              <div>
                <Label className="text-sm font-medium">Sessions per Week</Label>
                <Input className="mt-1.5" type="number" min={1} max={7} value={sessionsPerWeek}
                  onChange={(e) => setSessionsPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <Label className="text-sm font-medium">Course Type</Label>
                <Select value={courseType} onValueChange={(v) => setCourseType(v as CourseType)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COURSE_TYPES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {courseType === 'MODULAR' ? (
                <div>
                  <Label className="text-sm font-medium">Module</Label>
                  <Select value={String(moduleNumber)} onValueChange={(v) => setModuleNumber(Number(v))}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODULE_NUMBERS.map((n) => <SelectItem key={n} value={String(n)}>Module {n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label className="text-sm font-medium">Term of study</Label>
                  <Input className="mt-1.5" type="number" min={1} max={9} value={termNumber}
                    onChange={(e) => setTermNumber(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveUnit} disabled={upsertConfig.isPending}>
                {upsertConfig.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save unit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(() => {
        const sessionDocs = SESSION_LEVEL_DOC_TYPES.map((type) => {
          const doc = allDocs.find((d) => d.document_type === type && d.status !== 'REJECTED');
          const rejected = allDocs.find((d) => d.document_type === type && d.status === 'REJECTED');
          return { type, doc, rejected };
        });
        return (
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-semibold text-sm">Current Session Documents</p>
                  <p className="text-xs text-muted-foreground mt-0.5">One-time documents for {sessionLabel(year, term)}. They apply across all your units.</p>
                </div>
                <CalendarDays className="w-5 h-5 text-primary shrink-0" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sessionDocs.map(({ type, doc, rejected }) => {
                  const done = !!doc;
                  return (
                    <div key={type} className="rounded-lg border p-3 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                        {type === 'Personal Timetable' ? <CalendarDays className={`w-4 h-4 ${done ? 'text-emerald-600' : 'text-amber-600'}`} /> : <ClipboardCheck className={`w-4 h-4 ${done ? 'text-emerald-600' : 'text-amber-600'}`} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{type}</p>
                        <p className="text-[11px] text-muted-foreground">{done ? (doc?.status === 'SUBMITTED' ? 'Awaiting approval' : 'On file') : rejected ? 'Returned for correction' : 'Not submitted yet'}</p>
                      </div>
                      {done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : (
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                          <Link to={rejected ? '/submissions' : `/upload?type=${encodeURIComponent(type)}`}>{rejected ? 'Fix' : 'Upload'}</Link>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className="space-y-3">
        {units.map((u) => {
          const cov = unitCoverage(u.docs as unknown as ReportDoc[], u.unit_code);
          const weeklyKeys = new Set<string>();
          u.docs.forEach((d) => {
            if (WEEKLY_DOC_TYPES.includes(d.document_type as typeof WEEKLY_DOC_TYPES[number]) && d.week_number) {
              weeklyKeys.add(`${d.document_type}_${d.week_number}_${d.session_index || 1}`);
            }
          });
          const rocCount = new Set(
            u.docs.filter((d) => d.document_type === 'Records of Work Covered' && d.status !== 'REJECTED' && d.session_index)
              .map((d) => d.session_index),
          ).size;
          const complete = cov.missing.length === 0;


          return (
            <Card key={u.unit_code} className={complete ? 'border-emerald-500/40' : undefined}>
              <CardContent className="p-4">
                <div className="block">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${complete ? 'bg-emerald-500/10' : 'bg-primary/10'}`}>
                        <BookOpen className={`w-5 h-5 ${complete ? 'text-emerald-600' : 'text-primary'}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{u.unit_code}{u.unit_name ? ` — ${u.unit_name}` : ''}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {courseName(u.course_id) ? `${courseName(u.course_id)} • ` : ''}
                          {u.class_code || '—'} • {u.sessionsPerWeek} session(s)/week
                          {u.termNumber ? ` • Term ${u.termNumber}` : ''}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Required documents</span>
                    <span className="font-medium">{cov.done}/{cov.total}</span>
                  </div>
                  <Progress value={cov.pct} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {weeklyKeys.size} weekly record(s) on file · Records of Work Covered {rocCount}/2
                  </p>
                </div>

                {complete ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> All required documents submitted
                  </p>
                ) : (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {cov.missing.map((t) =>
                      cov.rejected.includes(t) ? (
                        <Link key={t} to="/submissions">
                          <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="w-3 h-3 mr-1" /> {t} — needs correction
                          </Badge>
                        </Link>
                      ) : (
                        <Link key={t} to={`/upload?unit=${encodeURIComponent(u.unit_code)}&type=${encodeURIComponent(t)}`}>
                          <Badge variant="secondary" className="text-[10px]">Pending: {t}</Badge>
                        </Link>
                      ),
                    )}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cov.missing.length > 0 && (
                    <Button asChild size="sm" variant="outline" className="h-10 sm:h-9">
                      <Link to={`/upload?unit=${encodeURIComponent(u.unit_code)}&type=${encodeURIComponent(cov.missing[0])}`}>
                        <Upload className="w-4 h-4 mr-1" /> Upload next required
                      </Link>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-10 sm:h-9">
                    <Link to="/submissions">
                      <FileText className="w-4 h-4 mr-1" /> View submissions
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}


        {units.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground">No units keyed in for this session yet</p>
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Add your first unit</Button>
          </div>
        )}
      </div>
    </div>
  );
}
