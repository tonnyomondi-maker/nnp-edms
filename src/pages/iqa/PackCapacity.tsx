// IQA / Super Admin — per-department active-pack capacity limits.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/sessions';

interface Row { department: string; active: number; capacity: number; }

const DEFAULT = 10;

export default function PackCapacity() {
  const { currentUser, activeRole, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');

  const load = async () => {
    setLoadingRows(true);
    const [statsRes, capsRes] = await Promise.all([
      // deno-lint-ignore no-explicit-any
      (supabase as any).rpc('verification_pack_stats_by_dept', { _capacity: DEFAULT }),
      // deno-lint-ignore no-explicit-any
      (supabase as any).from('department_pack_capacity').select('*'),
    ]);
    setLoadingRows(false);
    const statMap = new Map<string, { active: number; capacity: number }>();
    // deno-lint-ignore no-explicit-any
    ((statsRes.data as any[]) || []).forEach((r) => statMap.set(r.department, { active: Number(r.active), capacity: Number(r.capacity) }));
    const capMap = new Map<string, number>();
    // deno-lint-ignore no-explicit-any
    ((capsRes.data as any[]) || []).forEach((r) => capMap.set(r.department, r.active_pack_limit));

    const list: Row[] = DEPARTMENTS.map((d) => ({
      department: d,
      active: statMap.get(d)?.active || 0,
      capacity: capMap.get(d) ?? DEFAULT,
    }));
    setRows(list);
    const d: Record<string, number> = {};
    list.forEach((r) => { d[r.department] = r.capacity; });
    setDrafts(d);
  };

  useEffect(() => { if (canUse) load(); }, [canUse]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!canUse) return <Navigate to="/" replace />;

  const save = async (dept: string) => {
    const v = drafts[dept];
    if (v == null || isNaN(v) || v < 0 || v > 200) { toast.error('0–200 only'); return; }
    setBusy(true);
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any)
      .from('department_pack_capacity')
      .upsert({ department: dept, active_pack_limit: v, updated_by: currentUser.id }, { onConflict: 'department' });
    setBusy(false);
    if (error) { toast.error('Save failed', { description: error.message }); return; }
    toast.success(`${dept} limit → ${v}`);
    load();
  };

  const reset = async (dept: string) => {
    setBusy(true);
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from('department_pack_capacity').delete().eq('department', dept);
    setBusy(false);
    if (error) { toast.error('Reset failed', { description: error.message }); return; }
    toast.success(`${dept} reset to default (${DEFAULT})`);
    load();
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Pack Capacity" subtitle="Active-pack limit per department. Default is 10." />
      <Card>
        <CardHeader><CardTitle className="text-base">Department limits</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loadingRows && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loadingRows && rows.map((r) => {
            const overCapacity = r.active > (drafts[r.department] ?? r.capacity);
            return (
              <div key={r.department} className="border rounded p-3 flex flex-wrap items-center gap-2 text-xs">
                <div className="flex-1 min-w-[140px]">
                  <p className="font-medium">{r.department}</p>
                  <p className="text-muted-foreground">
                    {r.active} active · current limit {r.capacity}
                    {overCapacity && <span className="text-destructive ml-1">(over)</span>}
                  </p>
                </div>
                <Input
                  type="number" min={0} max={200}
                  value={drafts[r.department] ?? r.capacity}
                  onChange={(e) => setDrafts((p) => ({ ...p, [r.department]: parseInt(e.target.value, 10) }))}
                  className="h-8 w-20"
                />
                <Button size="sm" onClick={() => save(r.department)} disabled={busy} className="h-8 gap-1">
                  <Save className="w-3 h-3" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => reset(r.department)} disabled={busy} className="h-8 gap-1">
                  <RotateCcw className="w-3 h-3" /> Reset
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
