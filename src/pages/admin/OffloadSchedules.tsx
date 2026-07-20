import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, Save } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

interface Schedule {
  id?: string;
  department: string;
  enabled: boolean;
  cron_schedule: string;
  min_age_days: number;
  only_tier: 'cloud' | 'both';
  max_files_per_run: number;
  last_run_at?: string | null;
  last_result?: any;
}

export default function OffloadSchedules() {
  const { activeRole } = useAuth();
  const qc = useQueryClient();
  const allowed = activeRole === 'IQA' || activeRole === 'SUPER_ADMIN';
  const [busyDept, setBusyDept] = useState<string | null>(null);

  const { data: departments } = useQuery({
    enabled: allowed,
    queryKey: ['schedule-departments'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('department').not('department', 'is', null);
      return Array.from(new Set((data || []).map((d: any) => d.department).filter(Boolean))).sort() as string[];
    },
  });

  const { data: schedules } = useQuery({
    enabled: allowed,
    queryKey: ['offload-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('offload_schedules').select('*').order('department');
      if (error) throw error;
      return (data || []) as Schedule[];
    },
  });

  if (!allowed) return <Navigate to="/" replace />;

  const byDept = new Map((schedules || []).map((s) => [s.department, s]));

  async function save(dept: string, patch: Partial<Schedule>) {
    setBusyDept(dept);
    try {
      const existing = byDept.get(dept);
      const row: Schedule = {
        department: dept,
        enabled: existing?.enabled ?? false,
        cron_schedule: existing?.cron_schedule ?? '0 2 * * 0',
        min_age_days: existing?.min_age_days ?? 30,
        only_tier: existing?.only_tier ?? 'cloud',
        max_files_per_run: existing?.max_files_per_run ?? 100,
        ...patch,
      };
      const { error } = await supabase
        .from('offload_schedules')
        .upsert(row, { onConflict: 'department' });
      if (error) throw error;
      toast.success(`Saved schedule for ${dept}`);
      qc.invalidateQueries({ queryKey: ['offload-schedules'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusyDept(null);
    }
  }

  async function runNow(dept: string, dryRun: boolean) {
    setBusyDept(dept);
    try {
      const { data, error } = await supabase.functions.invoke('run-offload-schedules', {
        body: { department: dept, dryRun },
      });
      if (error) throw error;
      const r = data?.runs?.[0];
      if (!r) toast.info('No enabled schedule for this department');
      else toast.success(`${dryRun ? 'Would offload' : 'Offloaded'} ${r.offloaded} of ${r.eligible} eligible file(s)`);
      qc.invalidateQueries({ queryKey: ['offload-schedules'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setBusyDept(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Automatic Google Drive Offload"
        subtitle="Free Cloud Storage on a schedule once files are mirrored to Google Drive"
      />

      <div className="grid gap-4">
        {(departments || []).map((dept) => {
          const s = byDept.get(dept) || {
            department: dept, enabled: false, cron_schedule: '0 2 * * 0',
            min_age_days: 30, only_tier: 'cloud' as const, max_files_per_run: 100,
          };
          const busy = busyDept === dept;
          return (
            <Card key={dept}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{dept}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`en-${dept}`} className="text-sm">Enabled</Label>
                  <Switch
                    id={`en-${dept}`}
                    checked={!!s.enabled}
                    onCheckedChange={(v) => save(dept, { enabled: v })}
                  />
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <div>
                  <Label className="text-xs">Cron schedule</Label>
                  <Input
                    defaultValue={s.cron_schedule}
                    onBlur={(e) => e.target.value !== s.cron_schedule && save(dept, { cron_schedule: e.target.value })}
                    placeholder="0 2 * * 0"
                  />
                </div>
                <div>
                  <Label className="text-xs">Min age (days)</Label>
                  <Input
                    type="number" min={0}
                    defaultValue={s.min_age_days}
                    onBlur={(e) => save(dept, { min_age_days: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Only tier</Label>
                  <Select value={s.only_tier} onValueChange={(v) => save(dept, { only_tier: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cloud">Cloud only (offload-able)</SelectItem>
                      <SelectItem value="both">Cloud + Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Max files / run</Label>
                  <Input
                    type="number" min={1}
                    defaultValue={s.max_files_per_run}
                    onBlur={(e) => save(dept, { max_files_per_run: Number(e.target.value) || 1 })}
                  />
                </div>

                <div className="md:col-span-4 flex flex-wrap items-center gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => runNow(dept, true)} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Dry run
                  </Button>
                  <Button size="sm" onClick={() => runNow(dept, false)} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Run now
                  </Button>
                  {s.last_run_at && (
                    <span className="text-xs text-muted-foreground">
                      Last run {new Date(s.last_run_at).toLocaleString()} —
                      {' '}{s.last_result?.offloaded ?? 0}/{s.last_result?.eligible ?? 0} offloaded
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
