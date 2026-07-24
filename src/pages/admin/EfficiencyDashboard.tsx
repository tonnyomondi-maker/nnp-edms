// Admin efficiency dashboard: queue lengths per department, average approval
// cycle times per stage, and bottleneck detection. Purely read-only — pulls
// straight from `documents` and derives stage durations client-side.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, TrendingUp, Clock, Users } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Pick<
  Tables<'documents'>,
  | 'id'
  | 'department'
  | 'status'
  | 'submitted_at'
  | 'hod_approved_at'
  | 'dp_approved_at'
  | 'archived_at'
  | 'returned_at'
  | 'rejection_reason'
>;

type Stage = 'HOD' | 'DP' | 'IQA';

interface StageMetrics {
  queue: number;             // items currently waiting at this stage
  avgHours: number | null;   // avg cycle time to leave this stage (hours)
  sample: number;            // sample count for the average
  oldestHours: number | null;// oldest item currently in queue (hours)
}

interface DeptRow {
  department: string;
  totals: { submitted: number; approved: number; rejected: number };
  stages: Record<Stage, StageMetrics>;
  bottleneck: Stage | null;
}

const HOUR = 1000 * 60 * 60;

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

function computeStage(docs: Doc[], stage: Stage): StageMetrics {
  const now = Date.now();
  const durations: number[] = [];
  let queue = 0;
  let oldest: number | null = null;

  for (const d of docs) {
    if (stage === 'HOD') {
      const dur = diffHours(d.submitted_at, d.hod_approved_at);
      if (dur != null && dur >= 0) durations.push(dur);
      if (d.status === 'SUBMITTED' && d.submitted_at) {
        queue++;
        const age = (now - new Date(d.submitted_at).getTime()) / HOUR;
        oldest = oldest == null ? age : Math.max(oldest, age);
      }
    } else if (stage === 'DP') {
      const dur = diffHours(d.hod_approved_at, d.dp_approved_at);
      if (dur != null && dur >= 0) durations.push(dur);
      if (d.status === 'HOD_APPROVED' && d.hod_approved_at) {
        queue++;
        const age = (now - new Date(d.hod_approved_at).getTime()) / HOUR;
        oldest = oldest == null ? age : Math.max(oldest, age);
      }
    } else {
      const dur = diffHours(d.dp_approved_at, d.archived_at);
      if (dur != null && dur >= 0) durations.push(dur);
      if (d.status === 'DP_APPROVED' && d.dp_approved_at) {
        queue++;
        const age = (now - new Date(d.dp_approved_at).getTime()) / HOUR;
        oldest = oldest == null ? age : Math.max(oldest, age);
      }
    }
  }

  const avg = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : null;
  return { queue, avgHours: avg, sample: durations.length, oldestHours: oldest };
}

function bottleneckOf(m: Record<Stage, StageMetrics>): Stage | null {
  // Weighted signal: queue depth + oldest-age bias. A stage only qualifies
  // as a bottleneck when at least 2 items sit in it OR one has aged >72h.
  const stages: Stage[] = ['HOD', 'DP', 'IQA'];
  let best: { stage: Stage; score: number } | null = null;
  for (const s of stages) {
    const stat = m[s];
    if (stat.queue < 2 && (stat.oldestHours ?? 0) < 72) continue;
    const score = stat.queue * 10 + (stat.oldestHours ?? 0);
    if (!best || score > best.score) best = { stage: s, score };
  }
  return best?.stage ?? null;
}

export default function EfficiencyDashboard() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('documents')
        .select('id, department, status, submitted_at, hod_approved_at, dp_approved_at, archived_at, returned_at, rejection_reason')
        .order('submitted_at', { ascending: false })
        .limit(5000);
      setLoading(false);
      if (error) { setErr(error.message); return; }
      setDocs(data || []);
    })();
  }, []);

  const { rows, overall } = useMemo(() => {
    const byDept = new Map<string, Doc[]>();
    for (const d of docs) {
      const dept = d.department || '—';
      const list = byDept.get(dept) || [];
      list.push(d);
      byDept.set(dept, list);
    }

    const rows: DeptRow[] = [];
    for (const [department, list] of byDept) {
      const stages: Record<Stage, StageMetrics> = {
        HOD: computeStage(list, 'HOD'),
        DP: computeStage(list, 'DP'),
        IQA: computeStage(list, 'IQA'),
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
      HOD: computeStage(docs, 'HOD'),
      DP: computeStage(docs, 'DP'),
      IQA: computeStage(docs, 'IQA'),
    };
    return { rows, overall };
  }, [docs]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (err) return <p className="text-sm text-destructive">{err}</p>;

  const totalQueue = overall.HOD.queue + overall.DP.queue + overall.IQA.queue;
  const globalBottleneck = bottleneckOf(overall);

  return (
    <div className="space-y-4">
      <PageHeader title="Efficiency Dashboard" subtitle="Approval cycle times, queue depth & bottleneck detection" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={<Users className="w-4 h-4" />} label="Total documents" value={docs.length.toString()} />
        <StatTile icon={<Clock className="w-4 h-4" />} label="In-flight queue" value={totalQueue.toString()} />
        <StatTile
          icon={<TrendingUp className="w-4 h-4" />}
          label="Avg HOD → Archive"
          value={fmtHours(
            [overall.HOD.avgHours, overall.DP.avgHours, overall.IQA.avgHours]
              .filter((x): x is number => x != null)
              .reduce((s, v) => s + v, 0) || null,
          )}
        />
        <StatTile
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Global bottleneck"
          value={globalBottleneck ? globalBottleneck : 'None'}
          tone={globalBottleneck ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Stage averages (all departments)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {(['HOD', 'DP', 'IQA'] as Stage[]).map((s) => (
              <StageBox key={s} stage={s} m={overall[s]} highlight={globalBottleneck === s} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-department breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Department</th>
                  <th className="text-right px-2 py-2">Total</th>
                  <th className="text-right px-2 py-2">Archived</th>
                  <th className="text-right px-2 py-2">Rejected</th>
                  <th className="text-center px-2 py-2">HOD (queue · avg · oldest)</th>
                  <th className="text-center px-2 py-2">DP (queue · avg · oldest)</th>
                  <th className="text-center px-2 py-2">IQA (queue · avg · oldest)</th>
                  <th className="text-center px-2 py-2">Bottleneck</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">No documents yet.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.department} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.department}</td>
                    <td className="px-2 py-2 text-right">{r.totals.submitted}</td>
                    <td className="px-2 py-2 text-right text-primary">{r.totals.approved}</td>
                    <td className="px-2 py-2 text-right text-destructive">{r.totals.rejected}</td>
                    {(['HOD', 'DP', 'IQA'] as Stage[]).map((s) => (
                      <td key={s} className={`px-2 py-2 text-center ${r.bottleneck === s ? 'bg-amber-500/10' : ''}`}>
                        <span className="font-medium">{r.stages[s].queue}</span>
                        <span className="text-muted-foreground"> · {fmtHours(r.stages[s].avgHours)}</span>
                        <span className="text-muted-foreground"> · {fmtHours(r.stages[s].oldestHours)}</span>
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      {r.bottleneck ? (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3 mr-1" />{r.bottleneck}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Bottleneck = the stage with the highest queue-depth × oldest-age score. A stage
        qualifies once it holds ≥2 documents or a single item has aged past 72 hours.
        Averages use completed transitions only; "oldest" reflects items still waiting.
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
    </div>
  );
}
