import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { DEPARTMENTS, ONE_TIME_DOC_TYPES } from '@/lib/sessions';

interface DocRow {
  id: string;
  trainer_id: string;
  department: string;
  unit_code: string | null;
  document_type: string;
  status: string;
  submitted_at: string;
  hod_approved_at: string | null;
  dp_approved_at: string | null;
  archived_at: string | null;
}

export default function Reports() {
  const { currentUser, activeRole } = useAuth();
  const scopeDept = activeRole === 'HOD' ? currentUser?.department || '' : null;
  const scopeTrainer = activeRole === 'TRAINER' ? currentUser?.id || '' : null;

  const { data, isLoading } = useQuery({
    queryKey: ['reports', activeRole, scopeDept, scopeTrainer],
    queryFn: async () => {
      let docsQ = supabase.from('documents').select('id, trainer_id, department, unit_code, document_type, status, submitted_at, hod_approved_at, dp_approved_at, archived_at');
      if (scopeDept) docsQ = docsQ.eq('department', scopeDept);
      if (scopeTrainer) docsQ = docsQ.eq('trainer_id', scopeTrainer);
      const [docsRes, profilesRes, configsRes] = await Promise.all([
        docsQ,
        supabase.from('profiles').select('user_id, full_name, department'),
        supabase.from('unit_session_config' as never).select('trainer_id, department, unit_code'),
      ]);
      return {
        docs: (docsRes.data || []) as DocRow[],
        profiles: profilesRes.data || [],
        configs: (configsRes.data || []) as unknown as Array<{ trainer_id: string; department: string; unit_code: string }>,
      };
    },
  });

  const allDepts = activeRole === 'HOD' && scopeDept ? [scopeDept] : DEPARTMENTS;

  const perTrainer = useMemo(() => {
    if (!data) return [];
    const trainers = data.profiles.filter((p) => (scopeDept ? p.department === scopeDept : true));
    return trainers.map((t) => {
      const tDocs = data.docs.filter((d) => d.trainer_id === t.user_id);
      const tConfigs = data.configs.filter((c) => c.trainer_id === t.user_id);
      const units = new Set(tConfigs.map((c) => c.unit_code));
      const expected = units.size * ONE_TIME_DOC_TYPES.length;
      const oneTime = tDocs.filter((d) => (ONE_TIME_DOC_TYPES as readonly string[]).includes(d.document_type)).length;
      const pct = expected > 0 ? Math.round((Math.min(oneTime, expected) / expected) * 100) : 0;
      return {
        id: t.user_id,
        name: t.full_name,
        department: t.department,
        submitted: tDocs.filter((d) => d.status === 'SUBMITTED').length,
        approved: tDocs.filter((d) => ['HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED'].includes(d.status)).length,
        rejected: tDocs.filter((d) => d.status === 'REJECTED').length,
        units: units.size,
        oneTime,
        expected,
        pct,
      };
    }).filter((r) => r.units > 0 || r.submitted + r.approved + r.rejected > 0);
  }, [data, scopeDept]);

  const missing = useMemo(() => {
    if (!data) return [] as Array<{ trainer: string; unit: string; missing: string[] }>;
    const items: Array<{ trainer: string; unit: string; missing: string[] }> = [];
    data.configs.forEach((c) => {
      if (scopeDept && c.department !== scopeDept) return;
      if (scopeTrainer && c.trainer_id !== scopeTrainer) return;
      const trainerName = data.profiles.find((p) => p.user_id === c.trainer_id)?.full_name || '—';
      const unitDocs = data.docs.filter((d) => d.trainer_id === c.trainer_id && d.unit_code === c.unit_code && d.status !== 'REJECTED');
      const present = new Set(unitDocs.map((d) => d.document_type));
      const miss = ONE_TIME_DOC_TYPES.filter((t) => !present.has(t));
      if (miss.length > 0) items.push({ trainer: trainerName, unit: c.unit_code, missing: [...miss] });
    });
    return items;
  }, [data, scopeDept, scopeTrainer]);

  const deptCompliance = useMemo(() => {
    if (!data) return [];
    return allDepts.map((dept) => {
      const dConfigs = data.configs.filter((c) => c.department === dept);
      const dDocs = data.docs.filter((d) => d.department === dept);
      const expected = dConfigs.length * ONE_TIME_DOC_TYPES.length;
      const submitted = dDocs.filter((d) => (ONE_TIME_DOC_TYPES as readonly string[]).includes(d.document_type)).length;
      const pct = expected > 0 ? Math.round((Math.min(submitted, expected) / expected) * 100) : 0;
      return { dept, expected, submitted, pct };
    });
  }, [data, allDepts]);

  const throughput = useMemo(() => {
    if (!data) return null;
    const diffs = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 36e5 : null);
    const collect = (sel: (d: DocRow) => number | null) => {
      const arr = data.docs.map(sel).filter((v): v is number => v !== null && v >= 0);
      if (arr.length === 0) return null;
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
      return { avg, count: arr.length };
    };
    return {
      submittedToHod: collect((d) => diffs(d.submitted_at, d.hod_approved_at)),
      hodToDp: collect((d) => diffs(d.hod_approved_at, d.dp_approved_at)),
      dpToArchive: collect((d) => diffs(d.dp_approved_at, d.archived_at)),
      counts: {
        submitted: data.docs.filter((d) => d.status === 'SUBMITTED').length,
        hod: data.docs.filter((d) => d.status === 'HOD_APPROVED').length,
        dp: data.docs.filter((d) => d.status === 'DP_APPROVED').length,
        archived: data.docs.filter((d) => d.status === 'ARCHIVED').length,
        rejected: data.docs.filter((d) => d.status === 'REJECTED').length,
      },
    };
  }, [data]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle={scopeDept ? `${scopeDept}` : scopeTrainer ? 'Your submissions' : 'All departments'} />
      <Tabs defaultValue="trainer">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="trainer" className="flex-1">Per Trainer</TabsTrigger>
          <TabsTrigger value="missing" className="flex-1">Missing</TabsTrigger>
          <TabsTrigger value="dept" className="flex-1">Dept</TabsTrigger>
          <TabsTrigger value="flow" className="flex-1">Flow</TabsTrigger>
        </TabsList>

        <TabsContent value="trainer" className="space-y-3">
          {perTrainer.length === 0 ? <Empty /> : perTrainer.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="text-sm font-semibold">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.department}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{r.units} unit(s)</Badge>
                </div>
                <Progress value={r.pct} className="h-2" />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{r.oneTime}/{r.expected} one-time docs</span>
                  <span>{r.pct}%</span>
                </div>
                <div className="flex gap-1 text-[10px]">
                  <Badge variant="outline">Pending {r.submitted}</Badge>
                  <Badge variant="outline">Approved {r.approved}</Badge>
                  <Badge variant="outline">Rejected {r.rejected}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="missing" className="space-y-3">
          {missing.length === 0 ? <Empty text="No missing one-time documents" /> : missing.map((m, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <p className="text-sm font-semibold">{m.unit}</p>
                <p className="text-[11px] text-muted-foreground mb-2">{m.trainer}</p>
                <div className="flex flex-wrap gap-1">
                  {m.missing.map((d) => <Badge key={d} variant="destructive" className="text-[10px]">{d}</Badge>)}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="dept" className="space-y-3">
          {deptCompliance.map((d) => (
            <Card key={d.dept}>
              <CardContent className="p-4">
                <div className="flex justify-between mb-2">
                  <p className="text-sm font-semibold">{d.dept}</p>
                  <span className="text-xs font-medium">{d.pct}%</span>
                </div>
                <Progress value={d.pct} className="h-2" />
                <p className="text-[11px] text-muted-foreground mt-1">{d.submitted}/{d.expected} one-time documents</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="flow" className="space-y-3">
          {throughput && (
            <>
              <Card><CardContent className="p-4 grid grid-cols-5 gap-2 text-center">
                {(['submitted', 'hod', 'dp', 'archived', 'rejected'] as const).map((k) => (
                  <div key={k}>
                    <p className="text-lg font-bold">{throughput.counts[k]}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">{k}</p>
                  </div>
                ))}
              </CardContent></Card>
              <Card><CardContent className="p-4 space-y-2 text-sm">
                <FlowRow label="Submitted → HOD" data={throughput.submittedToHod} />
                <FlowRow label="HOD → DP" data={throughput.hodToDp} />
                <FlowRow label="DP → Archive" data={throughput.dpToArchive} />
              </CardContent></Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FlowRow({ label, data }: { label: string; data: { avg: number; count: number } | null }) {
  return (
    <div className="flex justify-between border-b last:border-0 pb-1">
      <span>{label}</span>
      <span className="text-muted-foreground text-xs">
        {data ? `Avg ${data.avg.toFixed(1)}h • ${data.count} docs` : 'No data'}
      </span>
    </div>
  );
}

function Empty({ text = 'No data yet' }: { text?: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
