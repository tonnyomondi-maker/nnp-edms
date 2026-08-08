// Admin efficiency dashboard: queue lengths, average cycle times, bottlenecks,
// SLA breaches, reason breakdown, per-approver drill-down, AI-generated
// insights and CSV export.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle, TrendingUp, Clock, Users, Download, Sparkles, Flag, Plus, Trash2 } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { useRoleGuard } from '@/hooks/useRoleGuard';

type Doc = Pick<
  Tables<'documents'>,
  | 'id'
  | 'department'
  | 'status'
  | 'document_type'
  | 'submitted_at'
  | 'hod_approved_at'
  | 'hod_approved_by'
  | 'dp_approved_at'
  | 'dp_approved_by'
  | 'archived_at'
  | 'iqa_archived_by'
  | 'returned_at'
  | 'return_note'
  | 'rejection_reason'
>;

type Sla = Tables<'sla_targets'>;
type Stage = 'HOD' | 'DP' | 'IQA';
const STAGES: Stage[] = ['HOD', 'DP', 'IQA'];
const HOUR = 1000 * 60 * 60;

interface StageMetrics {
  queue: number;
  avgHours: number | null;
  sample: number;
  oldestHours: number | null;
  slaBreaches: number;
}

interface DeptRow {
  department: string;
  totals: { submitted: number; approved: number; rejected: number };
  stages: Record<Stage, StageMetrics>;
  bottleneck: Stage | null;
}

interface ApproverRow {
  approverId: string;
  approverName: string;
  stage: Stage;
  handled: number;
  avgHours: number | null;
  slaBreaches: number;
}

function diffHours(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
}
function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function stageStart(d: Doc, stage: Stage): string | null {
  if (stage === 'HOD') return d.submitted_at;
  if (stage === 'DP') return d.hod_approved_at;
  return d.dp_approved_at;
}
function stageEnd(d: Doc, stage: Stage): string | null {
  if (stage === 'HOD') return d.hod_approved_at;
  if (stage === 'DP') return d.dp_approved_at;
  return d.archived_at;
}
function stageApprover(d: Doc, stage: Stage): string | null {
  if (stage === 'HOD') return d.hod_approved_by;
  if (stage === 'DP') return d.dp_approved_by;
  return d.iqa_archived_by;
}
function pendingAtStage(d: Doc, stage: Stage): boolean {
  if (stage === 'HOD') return d.status === 'SUBMITTED';
  if (stage === 'DP') return d.status === 'HOD_APPROVED';
  return d.status === 'DP_APPROVED';
}

function computeStage(
  docs: Doc[],
  stage: Stage,
  slaHoursByType: Map<string, number>,
): StageMetrics {
  const now = Date.now();
  const durations: number[] = [];
  let queue = 0;
  let oldest: number | null = null;
  let breaches = 0;

  for (const d of docs) {
    const start = stageStart(d, stage);
    const end = stageEnd(d, stage);
    const dur = diffHours(start, end);
    if (dur != null && dur >= 0) durations.push(dur);

    if (pendingAtStage(d, stage) && start) {
      queue++;
      const age = (now - new Date(start).getTime()) / HOUR;
      oldest = oldest == null ? age : Math.max(oldest, age);
      const target = slaHoursByType.get(d.document_type);
      if (target && age > target) breaches++;
    } else if (dur != null) {
      const target = slaHoursByType.get(d.document_type);
      if (target && dur > target) breaches++;
    }
  }
  const avg = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : null;
  return { queue, avgHours: avg, sample: durations.length, oldestHours: oldest, slaBreaches: breaches };
}

function bottleneckOf(m: Record<Stage, StageMetrics>): Stage | null {
  let best: { stage: Stage; score: number } | null = null;
  for (const s of STAGES) {
    const stat = m[s];
    if (stat.queue < 2 && (stat.oldestHours ?? 0) < 72) continue;
    const score = stat.queue * 10 + (stat.oldestHours ?? 0) + stat.slaBreaches * 5;
    if (!best || score > best.score) best = { stage: s, score };
  }
  return best?.stage ?? null;
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          if (v == null) return '';
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------- reason taxonomy classifier (lightweight, deterministic) -------
const TAXONOMY: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: 'missing_signature', label: 'Missing signature/stamp', patterns: [/signature/i, /stamp/i, /unsigned/i] },
  { key: 'incomplete_content', label: 'Incomplete content', patterns: [/incomplete/i, /missing (section|content|field)/i, /empty/i] },
  { key: 'wrong_format', label: 'Wrong format/template', patterns: [/format/i, /template/i, /layout/i, /structure/i] },
  { key: 'cbet_compliance', label: 'CBET/CDACC compliance', patterns: [/cbet/i, /cdacc/i, /learning outcome/i, /performance criteria/i] },
  { key: 'wrong_unit', label: 'Wrong unit/code', patterns: [/unit code/i, /wrong unit/i, /class code/i] },
  { key: 'illegible', label: 'Illegible / poor quality', patterns: [/illegible/i, /blurry/i, /unreadable/i, /quality/i] },
  { key: 'late', label: 'Late submission', patterns: [/late/i, /overdue/i, /past deadline/i] },
];
function classifyReason(text: string): string {
  for (const t of TAXONOMY) if (t.patterns.some((p) => p.test(text))) return t.label;
  return 'Other';
}

// ---------------------------------------------------------------------

export default function EfficiencyDashboard() {
  const { isSuperAdmin } = useRoleGuard();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [slas, setSlas] = useState<Sla[]>([]);
  const [profiles, setProfiles] = useState<Map<string, { full_name: string | null; email: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [deptFilter, setDeptFilter] = useState<string>('all');

  // AI insights
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary?: string; rootCauses?: Array<{ stage?: string; cause?: string; evidence?: string }>; improvements?: Array<{ action?: string; expectedImpact?: string; owner?: string }>; raw?: string; error?: string } | null>(null);

  // SLA editor
  const [newSla, setNewSla] = useState<{ document_type: string; stage: Stage; target_hours: number }>({
    document_type: 'Scheme of Work', stage: 'HOD', target_hours: 48,
  });

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    setLoading(true);
    const [docsRes, slaRes] = await Promise.all([
      supabase
        .from('documents')
        .select('id, department, status, document_type, submitted_at, hod_approved_at, hod_approved_by, dp_approved_at, dp_approved_by, archived_at, iqa_archived_by, returned_at, return_note, rejection_reason')
        .order('submitted_at', { ascending: false })
        .limit(10000),
      supabase.from('sla_targets').select('*'),
    ]);
    setLoading(false);
    if (docsRes.error) { setErr(docsRes.error.message); return; }
    setDocs((docsRes.data || []) as Doc[]);
    setSlas((slaRes.data || []) as Sla[]);

    const ids = new Set<string>();
    (docsRes.data || []).forEach((d) => {
      [d.hod_approved_by, d.dp_approved_by, d.iqa_archived_by].forEach((x) => x && ids.add(x));
    });
    if (ids.size) {
      const { data } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', [...ids]);
      const m = new Map<string, { full_name: string | null; email: string | null }>();
      (data || []).forEach((p) => m.set(p.user_id, { full_name: p.full_name, email: p.email }));
      setProfiles(m);
    }
  }

  const filteredDocs = useMemo(() => {
    const from = new Date(dateFrom).getTime();
    const to = new Date(dateTo).getTime() + 24 * HOUR;
    return docs.filter((d) => {
      const t = d.submitted_at ? new Date(d.submitted_at).getTime() : 0;
      if (t < from || t > to) return false;
      if (deptFilter !== 'all' && (d.department || '—') !== deptFilter) return false;
      return true;
    });
  }, [docs, dateFrom, dateTo, deptFilter]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => set.add(d.department || '—'));
    return [...set].sort();
  }, [docs]);

  // SLA lookup: prefer per-stage per-type; if none set for a type, undefined
  const slaLookup = useMemo(() => {
    const byStage: Record<Stage, Map<string, number>> = { HOD: new Map(), DP: new Map(), IQA: new Map() };
    slas.forEach((s) => byStage[s.stage as Stage].set(s.document_type, s.target_hours));
    return byStage;
  }, [slas]);

  const { rows, overall } = useMemo(() => {
    const byDept = new Map<string, Doc[]>();
    for (const d of filteredDocs) {
      const dept = d.department || '—';
      const list = byDept.get(dept) || [];
      list.push(d);
      byDept.set(dept, list);
    }
    const rows: DeptRow[] = [];
    for (const [department, list] of byDept) {
      const stages: Record<Stage, StageMetrics> = {
        HOD: computeStage(list, 'HOD', slaLookup.HOD),
        DP: computeStage(list, 'DP', slaLookup.DP),
        IQA: computeStage(list, 'IQA', slaLookup.IQA),
      };
      rows.push({
        department,
        totals: {
          submitted: list.length,
          approved: list.filter((d) => d.status === 'ARCHIVED').length,
          rejected: list.filter((d) => d.status === 'REJECTED').length,
        },
        stages,
        bottleneck: bottleneckOf(stages),
      });
    }
    rows.sort((a, b) => b.totals.submitted - a.totals.submitted);
    const overall: Record<Stage, StageMetrics> = {
      HOD: computeStage(filteredDocs, 'HOD', slaLookup.HOD),
      DP: computeStage(filteredDocs, 'DP', slaLookup.DP),
      IQA: computeStage(filteredDocs, 'IQA', slaLookup.IQA),
    };
    return { rows, overall };
  }, [filteredDocs, slaLookup]);

  // Approver drill-down
  const approverRows = useMemo(() => {
    const map = new Map<string, ApproverRow>();
    for (const d of filteredDocs) {
      for (const stage of STAGES) {
        const uid = stageApprover(d, stage);
        const dur = diffHours(stageStart(d, stage), stageEnd(d, stage));
        if (!uid || dur == null || dur < 0) continue;
        const key = `${uid}::${stage}`;
        const existing = map.get(key) || {
          approverId: uid, approverName: profiles.get(uid)?.full_name || profiles.get(uid)?.email || uid.slice(0, 8),
          stage, handled: 0, avgHours: 0, slaBreaches: 0,
        };
        existing.handled++;
        existing.avgHours = ((existing.avgHours || 0) * (existing.handled - 1) + dur) / existing.handled;
        const target = slaLookup[stage].get(d.document_type);
        if (target && dur > target) existing.slaBreaches++;
        map.set(key, existing);
      }
    }
    return [...map.values()].sort((a, b) => b.handled - a.handled);
  }, [filteredDocs, profiles, slaLookup]);

  // Reason breakdown per stage
  const reasonRows = useMemo(() => {
    const bucket: Record<Stage, Map<string, number>> = { HOD: new Map(), DP: new Map(), IQA: new Map() };
    for (const d of filteredDocs) {
      // Rejections: attribute to stage where it happened
      if (d.status === 'REJECTED' && d.rejection_reason) {
        const stage: Stage = d.dp_approved_at ? 'IQA' : d.hod_approved_at ? 'DP' : 'HOD';
        const label = classifyReason(d.rejection_reason);
        bucket[stage].set(label, (bucket[stage].get(label) || 0) + 1);
      }
      // Returns: attribute to stage above where returned from
      if (d.returned_at && d.return_note) {
        const stage: Stage = d.status === 'HOD_APPROVED' ? 'IQA' : d.status === 'SUBMITTED' ? 'DP' : 'DP';
        const label = classifyReason(d.return_note);
        bucket[stage].set(label, (bucket[stage].get(label) || 0) + 1);
      }
    }
    const rows: { stage: Stage; label: string; count: number }[] = [];
    for (const s of STAGES) for (const [label, count] of bucket[s]) rows.push({ stage: s, label, count });
    return rows.sort((a, b) => b.count - a.count);
  }, [filteredDocs]);

  // SLA-breach docs list (flagged)
  const breachedDocs = useMemo(() => {
    const now = Date.now();
    const out: { doc: Doc; stage: Stage; ageHours: number; target: number }[] = [];
    for (const d of filteredDocs) {
      for (const stage of STAGES) {
        if (!pendingAtStage(d, stage)) continue;
        const start = stageStart(d, stage);
        if (!start) continue;
        const target = slaLookup[stage].get(d.document_type);
        if (!target) continue;
        const age = (now - new Date(start).getTime()) / HOUR;
        if (age > target) out.push({ doc: d, stage, ageHours: age, target });
      }
    }
    return out.sort((a, b) => (b.ageHours - b.target) - (a.ageHours - a.target));
  }, [filteredDocs, slaLookup]);

  function exportDeptCsv() {
    const header = ['Department', 'Total', 'Archived', 'Rejected',
      'HOD Queue', 'HOD Avg (h)', 'HOD Oldest (h)', 'HOD SLA Breaches',
      'DP Queue', 'DP Avg (h)', 'DP Oldest (h)', 'DP SLA Breaches',
      'IQAO Queue', 'IQAO Avg (h)', 'IQAO Oldest (h)', 'IQAO SLA Breaches',
      'Bottleneck'];
    const body = rows.map((r) => [
      r.department, r.totals.submitted, r.totals.approved, r.totals.rejected,
      r.stages.HOD.queue, r.stages.HOD.avgHours?.toFixed(2) ?? '', r.stages.HOD.oldestHours?.toFixed(2) ?? '', r.stages.HOD.slaBreaches,
      r.stages.DP.queue, r.stages.DP.avgHours?.toFixed(2) ?? '', r.stages.DP.oldestHours?.toFixed(2) ?? '', r.stages.DP.slaBreaches,
      r.stages.IQA.queue, r.stages.IQA.avgHours?.toFixed(2) ?? '', r.stages.IQA.oldestHours?.toFixed(2) ?? '', r.stages.IQA.slaBreaches,
      r.bottleneck ?? '',
    ]);
    downloadFile(`efficiency_departments_${dateFrom}_${dateTo}.csv`, 'text/csv', toCsv([header, ...body]));
  }
  function exportApproverCsv() {
    const header = ['Approver', 'Stage', 'Handled', 'Avg (h)', 'SLA Breaches'];
    const body = approverRows.map((r) => [r.approverName, r.stage, r.handled, r.avgHours?.toFixed(2) ?? '', r.slaBreaches]);
    downloadFile(`efficiency_approvers_${dateFrom}_${dateTo}.csv`, 'text/csv', toCsv([header, ...body]));
  }
  function exportReasonsCsv() {
    const header = ['Stage', 'Reason', 'Count'];
    const body = reasonRows.map((r) => [r.stage, r.label, r.count]);
    downloadFile(`efficiency_reasons_${dateFrom}_${dateTo}.csv`, 'text/csv', toCsv([header, ...body]));
  }

  async function runAiInsights() {
    setAiLoading(true); setAiResult(null);
    const snapshot = {
      dateRange: { from: dateFrom, to: dateTo },
      department: deptFilter,
      overall,
      perDepartment: rows,
      topReasons: reasonRows.slice(0, 25),
      approverSummary: approverRows.slice(0, 20),
      slaBreachedCount: breachedDocs.length,
      slaTargets: slas.map(({ document_type, stage, target_hours }) => ({ document_type, stage, target_hours })),
    };
    const { data, error } = await supabase.functions.invoke('ai-efficiency-insights', { body: { snapshot } });
    setAiLoading(false);
    if (error) { toast({ title: 'AI insights failed', description: error.message, variant: 'destructive' }); return; }
    setAiResult(data as typeof aiResult);
  }

  async function addSla() {
    if (!newSla.document_type || !newSla.stage || newSla.target_hours <= 0) return;
    const { error } = await supabase.from('sla_targets').upsert({
      document_type: newSla.document_type as Sla['document_type'],
      stage: newSla.stage,
      target_hours: newSla.target_hours,
    }, { onConflict: 'document_type,stage' });
    if (error) { toast({ title: 'Failed to save SLA', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'SLA saved' });
    void refresh();
  }
  async function deleteSla(id: string) {
    const { error } = await supabase.from('sla_targets').delete().eq('id', id);
    if (error) { toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }); return; }
    void refresh();
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;

  const totalQueue = overall.HOD.queue + overall.DP.queue + overall.IQA.queue;
  const globalBottleneck = bottleneckOf(overall);
  const totalBreaches = overall.HOD.slaBreaches + overall.DP.slaBreaches + overall.IQA.slaBreaches;

  return (
    <div className="space-y-4">
      <PageHeader title="Efficiency Dashboard" subtitle="Approval cycle times, queue depth, SLA breaches & AI-assisted diagnostics" />

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Department</Label>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={exportDeptCsv}><Download className="w-3.5 h-3.5 mr-1" />Departments CSV</Button>
            <Button size="sm" variant="outline" onClick={exportApproverCsv}><Download className="w-3.5 h-3.5 mr-1" />Approvers CSV</Button>
            <Button size="sm" variant="outline" onClick={exportReasonsCsv}><Download className="w-3.5 h-3.5 mr-1" />Reasons CSV</Button>
          </div>
        </CardContent>
      </Card>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={<Users className="w-4 h-4" />} label="Documents in range" value={filteredDocs.length.toString()} />
        <StatTile icon={<Clock className="w-4 h-4" />} label="In-flight queue" value={totalQueue.toString()} />
        <StatTile icon={<Flag className="w-4 h-4" />} label="SLA breaches" value={totalBreaches.toString()} tone={totalBreaches > 0 ? 'warn' : undefined} />
        <StatTile icon={<AlertTriangle className="w-4 h-4" />} label="Bottleneck" value={globalBottleneck || 'None'} tone={globalBottleneck ? 'warn' : undefined} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="approvers">Approver drill-down</TabsTrigger>
          <TabsTrigger value="reasons">Reason taxonomy</TabsTrigger>
          <TabsTrigger value="sla">SLA breaches ({breachedDocs.length})</TabsTrigger>
          <TabsTrigger value="ai"><Sparkles className="w-3.5 h-3.5 mr-1" />AI insights</TabsTrigger>
          <TabsTrigger value="config">SLA targets</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Stage averages</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {STAGES.map((s) => (
                  <StageBox key={s} stage={s} m={overall[s]} highlight={globalBottleneck === s} />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Per-department breakdown</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Department</th>
                    <th className="text-right px-2 py-2">Total</th>
                    <th className="text-right px-2 py-2">Archived</th>
                    <th className="text-right px-2 py-2">Rejected</th>
                    {STAGES.map((s) => (
                      <th key={s} className="text-center px-2 py-2">{s} (queue · avg · oldest · SLA✗)</th>
                    ))}
                    <th className="text-center px-2 py-2">Bottleneck</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">No documents in this range.</td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.department} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{r.department}</td>
                      <td className="px-2 py-2 text-right">{r.totals.submitted}</td>
                      <td className="px-2 py-2 text-right text-primary">{r.totals.approved}</td>
                      <td className="px-2 py-2 text-right text-destructive">{r.totals.rejected}</td>
                      {STAGES.map((s) => (
                        <td key={s} className={`px-2 py-2 text-center ${r.bottleneck === s ? 'bg-amber-500/10' : ''}`}>
                          <span className="font-medium">{r.stages[s].queue}</span>
                          <span className="text-muted-foreground"> · {fmtHours(r.stages[s].avgHours)}</span>
                          <span className="text-muted-foreground"> · {fmtHours(r.stages[s].oldestHours)}</span>
                          <span className={r.stages[s].slaBreaches ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}> · {r.stages[s].slaBreaches}</span>
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center">
                        {r.bottleneck ? (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="w-3 h-3 mr-1" />{r.bottleneck}
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvers">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Per-approver cycle time</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Approver</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Handled</TableHead>
                    <TableHead className="text-right">Avg time</TableHead>
                    <TableHead className="text-right">SLA breaches</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approverRows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No approvals in this range.</TableCell></TableRow>
                  )}
                  {approverRows.map((r) => (
                    <TableRow key={`${r.approverId}-${r.stage}`}>
                      <TableCell className="font-medium">{r.approverName}</TableCell>
                      <TableCell><Badge variant="secondary">{r.stage}</Badge></TableCell>
                      <TableCell className="text-right">{r.handled}</TableCell>
                      <TableCell className="text-right">{fmtHours(r.avgHours)}</TableCell>
                      <TableCell className={`text-right ${r.slaBreaches ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>{r.slaBreaches}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reasons">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rejection / return reason breakdown</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Reasons are auto-classified into a fixed taxonomy from the rejection reason or return note text.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Reason category</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead>Distribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reasonRows.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No rejections or returns in this range.</TableCell></TableRow>
                  )}
                  {(() => {
                    const max = Math.max(1, ...reasonRows.map((r) => r.count));
                    return reasonRows.map((r) => (
                      <TableRow key={`${r.stage}-${r.label}`}>
                        <TableCell><Badge variant="secondary">{r.stage}</Badge></TableCell>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right font-medium">{r.count}</TableCell>
                        <TableCell>
                          <div className="h-2 rounded bg-muted overflow-hidden w-40">
                            <div className="h-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Documents breaching SLA</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Over by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breachedDocs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No SLA breaches — nice.</TableCell></TableRow>
                  )}
                  {breachedDocs.map((b) => (
                    <TableRow key={`${b.doc.id}-${b.stage}`}>
                      <TableCell className="font-medium">{b.doc.document_type}</TableCell>
                      <TableCell>{b.doc.department}</TableCell>
                      <TableCell><Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">{b.stage}</Badge></TableCell>
                      <TableCell className="text-right">{fmtHours(b.ageHours)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{b.target}h</TableCell>
                      <TableCell className="text-right text-amber-600 dark:text-amber-400 font-semibold">{fmtHours(b.ageHours - b.target)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">AI bottleneck insights</CardTitle>
                <p className="text-[11px] text-muted-foreground">Summarises likely root causes and proposes process improvements based on the current filters.</p>
              </div>
              <Button size="sm" onClick={runAiInsights} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                Generate insights
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {!aiResult && <p className="text-xs text-muted-foreground">Click "Generate insights" to analyse this snapshot with AI.</p>}
              {aiResult?.error && <p className="text-xs text-destructive">{aiResult.error}</p>}
              {aiResult?.summary && (
                <div className="p-3 rounded bg-primary/5 border border-primary/20 text-sm">{aiResult.summary}</div>
              )}
              {aiResult?.rootCauses?.length ? (
                <div>
                  <p className="text-xs font-semibold mb-1">Likely root causes</p>
                  <ul className="space-y-1.5">
                    {aiResult.rootCauses.map((r, i) => (
                      <li key={i} className="text-xs p-2 rounded border border-border">
                        <span className="font-semibold">{r.stage || '—'}: </span>{r.cause}
                        {r.evidence && <div className="text-muted-foreground mt-0.5">Evidence: {r.evidence}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aiResult?.improvements?.length ? (
                <div>
                  <p className="text-xs font-semibold mb-1">Suggested improvements</p>
                  <ul className="space-y-1.5">
                    {aiResult.improvements.map((r, i) => (
                      <li key={i} className="text-xs p-2 rounded border border-border">
                        <span className="font-semibold">{r.action}</span>
                        {r.expectedImpact && <div className="text-muted-foreground">Impact: {r.expectedImpact}</div>}
                        {r.owner && <div className="text-muted-foreground">Owner: {r.owner}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aiResult?.raw && <pre className="text-[11px] whitespace-pre-wrap bg-muted p-2 rounded">{aiResult.raw}</pre>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">SLA targets per document type &amp; stage</CardTitle>
              <p className="text-[11px] text-muted-foreground">Documents pending or completed at each stage are flagged when their time exceeds the target hours.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {isSuperAdmin && (
                <div className="flex flex-wrap items-end gap-2 p-2 rounded border border-border">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Document type</Label>
                    <Select value={newSla.document_type} onValueChange={(v) => setNewSla({ ...newSla, document_type: v })}>
                      <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['Learning Plan','Personal Timetable','Workload Allocation','Scheme of Work','Session Plan','Class Attendance','Course Outline'].map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Stage</Label>
                    <Select value={newSla.stage} onValueChange={(v: Stage) => setNewSla({ ...newSla, stage: v })}>
                      <SelectTrigger className="h-8 w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Target (hours)</Label>
                    <Input type="number" min={1} className="h-8 w-[120px]" value={newSla.target_hours}
                      onChange={(e) => setNewSla({ ...newSla, target_hours: Number(e.target.value) })} />
                  </div>
                  <Button size="sm" onClick={addSla}><Plus className="w-3.5 h-3.5 mr-1" />Save target</Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document type</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Target (hours)</TableHead>
                    {isSuperAdmin && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slas.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No SLA targets configured.</TableCell></TableRow>
                  )}
                  {slas.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.document_type}</TableCell>
                      <TableCell><Badge variant="secondary">{s.stage}</Badge></TableCell>
                      <TableCell className="text-right">{s.target_hours}</TableCell>
                      {isSuperAdmin && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteSla(s.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground">
        Bottleneck = highest queue-depth × oldest-age score with an SLA-breach boost. Reason taxonomy is derived by pattern-matching rejection reasons and return notes. CSV exports respect the active filters. PDF export can be produced by printing this page to PDF from your browser.
      </p>
    </div>
  );
}

function StatTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: 'warn' }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}{label}</div>
        <p className={`text-2xl font-semibold mt-1 ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function StageBox({ stage, m, highlight }: { stage: Stage; m: StageMetrics; highlight: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-sm">{stage}</p>
        {highlight && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
      </div>
      <p className="text-[11px] text-muted-foreground">Queue: <span className="text-foreground font-medium">{m.queue}</span></p>
      <p className="text-[11px] text-muted-foreground">Avg cycle: <span className="text-foreground font-medium">{fmtHours(m.avgHours)}</span> <span className="opacity-60">(n={m.sample})</span></p>
      <p className="text-[11px] text-muted-foreground">Oldest waiting: <span className="text-foreground font-medium">{fmtHours(m.oldestHours)}</span></p>
      <p className="text-[11px] text-muted-foreground">SLA breaches: <span className={m.slaBreaches ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-foreground font-medium'}>{m.slaBreaches}</span></p>
    </div>
  );
}
