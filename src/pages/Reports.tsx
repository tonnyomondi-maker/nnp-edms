import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, FileDown } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { DEPARTMENTS, ONE_TIME_DOC_TYPES, getCurrentSession, getSessionOptions, sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useCurrentSession } from '@/hooks/useAcademicSession';
import {
  trainerCoverage,
  missingByUnit,
  departmentCoverage,
  flowStats,
  type ReportDoc,
  type ReportConfig,
  type ReportProfile,
} from '@/lib/reportMetrics';
import { exportReportPdf } from '@/lib/reportPdf';

export default function Reports() {
  const { currentUser, activeRole } = useAuth();
  const scopeDept = activeRole === 'HOD' ? currentUser?.department || '' : null;
  const scopeTrainer = activeRole === 'TRAINER' ? currentUser?.id || '' : null;

  const current = getCurrentSession();
  const sessionOptions = useMemo(() => getSessionOptions(), []);
  const { data: adminSession } = useCurrentSession();
  const [year, setYear] = useState<number>(current.year);
  const [term, setTerm] = useState<SessionTerm>(current.term);
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  useEffect(() => {
    if (!adminSession) return;
    setYear(adminSession.session_year);
    setTerm(adminSession.session_term as SessionTerm);
  }, [adminSession]);

  const { data, isLoading } = useQuery({
    queryKey: ['reports', activeRole, scopeDept, scopeTrainer, year, term],
    queryFn: async () => {
      let docsQ = supabase
        .from('documents')
        .select('id, trainer_id, department, unit_code, document_type, status, version, rejection_count, submitted_at, hod_approved_at, iqa_reviewed_at, dp_approved_at, archived_at')
        .eq('session_year', year)
        .eq('session_term', term);
      if (scopeDept) docsQ = docsQ.eq('department', scopeDept);
      if (scopeTrainer) docsQ = docsQ.eq('trainer_id', scopeTrainer);

      let cfgQ = supabase
        .from('unit_session_config')
        .select('trainer_id, department, unit_code')
        .eq('session_year', year)
        .eq('session_term', term);
      if (scopeDept) cfgQ = cfgQ.eq('department', scopeDept);
      if (scopeTrainer) cfgQ = cfgQ.eq('trainer_id', scopeTrainer);

      const [docsRes, profilesRes, configsRes] = await Promise.all([
        docsQ,
        supabase.from('profiles').select('user_id, full_name, department'),
        cfgQ,
      ]);

      return {
        docs: (docsRes.data || []) as unknown as ReportDoc[],
        profiles: (profilesRes.data || []) as unknown as ReportProfile[],
        configs: (configsRes.data || []) as unknown as ReportConfig[],
      };
    },
  });

  const scoped = useMemo(() => {
    if (!data) return { docs: [] as ReportDoc[], configs: [] as ReportConfig[], profiles: [] as ReportProfile[] };
    if (deptFilter === 'ALL' || scopeDept) return data;
    return {
      ...data,
      docs: data.docs.filter((d) => d.department === deptFilter),
      configs: data.configs.filter((c) => c.department === deptFilter),
    };
  }, [data, deptFilter, scopeDept]);

  const allDepts = scopeDept ? [scopeDept] : deptFilter === 'ALL' ? DEPARTMENTS : [deptFilter];

  const perTrainer = useMemo(() => trainerCoverage(scoped), [scoped]);
  const missing = useMemo(() => missingByUnit(scoped), [scoped]);
  const deptRows = useMemo(() => departmentCoverage(scoped, allDepts), [scoped, allDepts]);
  const flow = useMemo(() => flowStats(scoped.docs), [scoped]);

  const canExport = activeRole === 'HOD' || activeRole === 'IQA' || activeRole === 'SUPER_ADMIN' || activeRole === 'DP_ACADEMICS';
  const scopeLabel = scopeDept ? scopeDept : scopeTrainer ? 'My submissions' : deptFilter === 'ALL' ? 'All departments' : deptFilter;

  const handleExport = () => {
    try {
      exportReportPdf({
        sessionTitle: sessionLabel(year, term),
        scopeLabel,
        generatedBy: currentUser?.name || currentUser?.email || '—',
        perTrainer,
        missing,
        deptRows,
        flow,
      });
      toast({ title: 'Report exported', description: 'The PDF has been downloaded.' });
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const totals = useMemo(() => {
    const expected = perTrainer.reduce((s, r) => s + r.expected, 0);
    const covered = perTrainer.reduce((s, r) => s + r.covered, 0);
    return {
      trainers: perTrainer.length,
      submittedTrainers: perTrainer.filter((r) => r.covered > 0).length,
      expected,
      covered,
      pct: expected > 0 ? Math.round((covered / expected) * 100) : 0,
    };
  }, [perTrainer]);

  return (
    <div className="pb-6">
      <PageHeader title="Reports" subtitle={`${sessionLabel(year, term)} • ${scopeLabel}`} />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Select
          value={`${year}_${term}`}
          onValueChange={(v) => {
            setYear(Number(v.split('_')[0]));
            setTerm(v.substring(v.indexOf('_') + 1) as SessionTerm);
          }}
        >
          <SelectTrigger className="h-11 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sessionOptions.map((o) => (
              <SelectItem key={`${o.year}_${o.term}`} value={`${o.year}_${o.term}`}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!scopeDept && !scopeTrainer && (
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-11 flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {canExport && (
          <Button className="h-11" onClick={handleExport} disabled={isLoading}>
            <FileDown className="w-4 h-4 mr-1.5" /> Export PDF
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <Card className="mb-4">
            <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Metric value={`${totals.submittedTrainers}/${totals.trainers}`} label="Trainers submitting" />
              <Metric value={`${totals.covered}/${totals.expected}`} label="Documents on file" />
              <Metric value={`${totals.pct}%`} label="Coverage" />
              <Metric value={String(flow.counts.rejected)} label="Rejected now" />
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground mb-3">
            Coverage counts each required document type once per unit. Repeat uploads and rejected
            versions of the same type never inflate the figure.
          </p>

          <Tabs defaultValue="trainer">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="trainer" className="flex-1">Trainers</TabsTrigger>
              <TabsTrigger value="missing" className="flex-1">Missing</TabsTrigger>
              <TabsTrigger value="dept" className="flex-1">Dept</TabsTrigger>
              <TabsTrigger value="flow" className="flex-1">Flow</TabsTrigger>
            </TabsList>

            <TabsContent value="trainer" className="space-y-3">
              {perTrainer.length === 0 ? <Empty /> : perTrainer.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{r.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{r.department}</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{r.units} unit(s)</Badge>
                    </div>
                    <Progress value={r.pct} className="h-2" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>{r.covered}/{r.expected} required documents on file</span>
                      <span>{r.pct}%</span>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <Badge variant="outline">Awaiting review {r.pending}</Badge>
                      <Badge variant="outline">Approved {r.approved}</Badge>
                      <Badge variant="outline">Needs correction {r.rejectedTypes}</Badge>
                      <Badge variant="outline">{r.uploads} upload(s)</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="missing" className="space-y-3">
              {missing.length === 0 ? <Empty text="Every unit has all required documents on file" /> : missing.map((m, i) => (
                <Card key={`${m.unit}-${i}`}>
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold break-words">{m.unit}</p>
                    <p className="text-[11px] text-muted-foreground mb-2">{m.trainer} • {m.department}</p>
                    <div className="flex flex-wrap gap-1">
                      {m.missing.map((d) => <Badge key={d} variant="destructive" className="text-[10px]">{d}</Badge>)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="dept" className="space-y-3">
              {deptRows.length === 0 ? <Empty /> : deptRows.map((d) => (
                <Card key={d.dept}>
                  <CardContent className="p-4">
                    <div className="flex justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold break-words">{d.dept}</p>
                      <span className="text-xs font-medium shrink-0">{d.pct}%</span>
                    </div>
                    <Progress value={d.pct} className="h-2" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {d.covered}/{d.expected} required documents • {d.trainers} trainer(s) • {d.units} unit(s)
                    </p>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="flow" className="space-y-3">
              <Card><CardContent className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {(['submitted', 'hod', 'iqa', 'dp', 'archived', 'rejected'] as const).map((k) => (
                  <div key={k}>
                    <p className="text-lg font-bold">{flow.counts[k]}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">{k}</p>
                  </div>
                ))}
              </CardContent></Card>
              <Card><CardContent className="p-4 space-y-2 text-sm">
                {flow.stages.map((s) => (
                  <div key={s.label} className="flex justify-between gap-2 border-b last:border-0 pb-1">
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span className="text-muted-foreground text-xs shrink-0">
                      {s.avg !== null ? `Avg ${s.avg.toFixed(1)}h • ${s.count} docs` : 'No data'}
                    </span>
                  </div>
                ))}
              </CardContent></Card>
              <p className="text-[11px] text-muted-foreground">
                Required one-time document types: {ONE_TIME_DOC_TYPES.join(', ')}.
              </p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
    </div>
  );
}

function Empty({ text = 'No data for this training session' }: { text?: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
