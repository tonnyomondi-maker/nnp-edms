// Lists registered units (unit_session_config) and lets an HOD (own department)
// or Super Admin remove a wrongly allocated unit. Documents are never deleted.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Loader2, Search, Trash2 } from 'lucide-react';

interface Row {
  id: string; trainer_id: string; department: string; unit_code: string; unit_name: string | null;
  class_code: string | null; session_year: number; session_term: string;
}

export function UnitAllocationsManager({ department }: { department?: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['unit-allocations', department ?? 'ALL'],
    queryFn: async () => {
      let q = supabase.from('unit_session_config').select('id, trainer_id, department, unit_code, unit_name, class_code, session_year, session_term')
        .order('session_year', { ascending: false });
      if (department) q = q.eq('department', department);
      const { data: units, error } = await q;
      if (error) throw error;
      const ids = Array.from(new Set((units || []).map((u) => u.trainer_id)));
      const { data: profs } = ids.length
        ? await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids)
        : { data: [] as { user_id: string; full_name: string; email: string }[] };
      const names = new Map((profs || []).map((p) => [p.user_id, p.full_name || p.email]));
      return (units || []).map((u) => ({ ...(u as Row), trainer: names.get(u.trainer_id) || 'Unknown trainer' }));
    },
  });

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (data || []).filter((r) => !s || [r.trainer, r.unit_code, r.unit_name, r.class_code, r.department].some((v) => v?.toLowerCase().includes(s)));
  }, [data, search]);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    const { data: res, error } = await supabase.rpc('delete_unit_allocation', { _config_id: target.id, _reason: reason });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove unit', description: error.message, variant: 'destructive' }); return; }
    const kept = (res as { documents_kept?: number } | null)?.documents_kept ?? 0;
    toast({ title: 'Unit removed', description: kept ? `${kept} submitted document(s) for this unit were kept safely.` : 'The unit was removed from the trainer’s list.' });
    setTarget(null); setReason('');
    qc.invalidateQueries({ queryKey: ['unit-allocations'] });
    qc.invalidateQueries({ queryKey: ['hod-dashboard'] });
    qc.invalidateQueries({ queryKey: ['unit-configs'] });
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trainer or unit…" className="pl-9" />
      </div>
      <p className="text-[11px] text-muted-foreground">Remove a unit only when the trainer asks because it was registered by mistake. Their submitted documents are kept.</p>
      {isLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        : rows.length === 0 ? <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No registered units found.</CardContent></Card>
        : <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{r.unit_code} — {r.unit_name || 'Unnamed unit'}</p>
                <p className="text-[11px] text-muted-foreground truncate">{r.trainer} • {r.class_code || 'No class'} • {r.department} • {r.session_term} {r.session_year}</p>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive h-8" onClick={() => setTarget(r)} aria-label="Remove unit">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this unit?</DialogTitle>
            <DialogDescription>
              {target?.unit_code} — {target?.unit_name} for {(target as (Row & { trainer?: string }) | null)?.trainer}. Documents already submitted are not deleted.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. Trainer requested — unit allocated by mistake)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={remove}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Remove unit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
