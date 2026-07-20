import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface ProgressRow {
  job_id: string;
  phase: 'queued' | 'running' | 'success' | 'error';
  total: number;
  processed: number;
  skipped: number;
  retries: number;
  message: string | null;
  kind: string;
  department: string | null;
  updated_at: string;
}

export function ExportProgressPanel({ jobIds }: { jobIds: string[] }) {
  const [rows, setRows] = useState<Record<string, ProgressRow>>({});

  useEffect(() => {
    if (jobIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('export_progress')
        .select('*')
        .in('job_id', jobIds);
      if (!cancelled && data) {
        setRows((prev) => {
          const next = { ...prev };
          (data as ProgressRow[]).forEach((r) => { next[r.job_id] = r; });
          return next;
        });
      }
    })();

    const channel = supabase
      .channel(`export-progress-${jobIds.join('-')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'export_progress' },
        (payload) => {
          const r = (payload.new || payload.old) as ProgressRow;
          if (r?.job_id && jobIds.includes(r.job_id)) {
            setRows((prev) => ({ ...prev, [r.job_id]: r }));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [jobIds.join(',')]);

  const list = jobIds.map((id) => rows[id]).filter(Boolean);
  if (list.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Export progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.map((r) => {
          const pct = r.total > 0 ? Math.min(100, Math.round(((r.processed + r.skipped) / r.total) * 100)) : 0;
          return (
            <div key={r.job_id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  {r.phase === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                  {r.phase === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                  {r.phase === 'error' && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                  <span className="font-medium">
                    {r.kind === 'session_export' ? 'Session ZIP' : r.kind}
                    {r.department ? ` · ${r.department}` : ''}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{r.phase}</Badge>
                </div>
                <span className="text-muted-foreground">
                  {r.processed}/{r.total} · {r.skipped} skipped · {r.retries} retries
                </span>
              </div>
              <Progress value={pct} className="h-1.5" />
              {r.message && <p className="text-[11px] text-muted-foreground truncate">{r.message}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
