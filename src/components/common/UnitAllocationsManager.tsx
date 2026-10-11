// HOD: sees only units their trainers asked to remove (approve / dismiss).
// Super Admin: sees all units, can approve requests or remove directly as an emergency override.
// Documents are never deleted.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Loader2, Search, Trash2, X } from 'lucide-react';

interface Row {
  id: string; trainer_id: string; department: string; unit_code: string; unit_name: string | null;
  class_code: string | null; session_year: number; session_term: string;
  trainer: string; request?: { id: string; reason: string } | null;
}

export function UnitAllocationsManager({ department }: { department?: string }) {
  const qc = useQueryClient();
  const adminMode = !department;
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Row | null>(null);
  const [mode, setMode] = useState<'remove' | 'dismiss'>('remove');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['unit-allocations', department ?? 'ALL'],
    queryFn: async () => {
      let rq = supabase.from('unit_deletion_requests').select('id, config_id, reason').eq('status', 'PENDING');
      if (department) rq = rq.eq('department', department);
      const { data: reqs } = await rq;
      const reqMap = new Map((reqs || []).map((r) => [r.config_id, { id: r.id, reason: r.reason }]));
      if (!adminMode && reqMap.size === 0) return [] as Row[];
      let q = supabase.from('unit_session_config').select('id, trainer_id, department, unit_code, unit_name, class_code, session_year, session_term')
        .order('session_year', { ascending: false });
      if (department) q = q.eq('department', department).in('id', Array.from(reqMap.keys()));
      const { data: units, error } = await q;
      if (error) throw error;
      const ids = Array.from(new Set((units || []).map((u) => u.trainer_id)));
      const { data: profs } = ids.length
        ? await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids)
        : { data: [] as { user_id: string; full_name: string; email: string }[] };
      const names = new Map((profs || []).map((p) => [p.user_id, p.full_name || p.email]));
      return (units || []).map((u) => ({ ...u, trainer: names.get(u.trainer_id) || 'Unknown trainer', request: reqMap.get(u.id) ?? null }) as Row)
        .sort((a, b) => Number(!!b.request) - Number(!!a.request));
    },
  });

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (data || []).filter((r) => !s || [r.trainer, r.unit_code, r.unit_name, r.class_code, r.department].some((v) => v?.toLowerCase().includes(s)));
  }, [data, search]);

  const close = () => { setTarget(null); setReason(''); };
  const refresh = () => {
    ['unit-allocations', 'unit-deletion-requests', 'hod-dashboard', 'unit-configs'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    if (mode === 'dismiss' && target.request) {
      const { error } = await supabase.rpc('dismiss_unit_deletion_request', { _request_id: target.request.id, _note: reason });
      setBusy(false);
      if (error) { toast({ title: 'Could not dismiss', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Request dismissed', description: 'The unit stays on the trainer’s list.' });
    } else {
      const { data: res, error } = await supabase.rpc('delete_unit_allocation', { _config_id: target.id, _reason: reason });
      setBusy(false);
      if (error) { toast({ title: 'Could not remove unit', description: error.message, variant: 'destructive' }); return; }
      const kept = (res as { documents_kept?: number } | null)?.documents_kept ?? 0;
      toast({ title: 'Unit removed', description: kept ? `${kept} submitted document(s) for this unit were kept safely.` : 'The unit was removed from the trainer’s list.' });
    }
    close(); refresh();
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trainer or unit…" className="pl-9" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {adminMode
          ? 'Units with a trainer removal request are listed first. Removing a unit without a request is an emergency override and is recorded in the audit log.'
          : 'Only units your trainers have asked to remove appear here. Their submitted documents are always kept.'}
      </p>
      {isLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        : rows.length === 0 ? <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">{adminMode ? 'No registered units found.' : 'No removal requests right now.'}</CardContent></Card>
        : <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">
                  {r.unit_code} — {r.unit_name || 'Unnamed unit'}
                  {r.request && <Badge variant="destructive" className="ml-2 text-[10px]">Removal requested</Badge>}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{r.trainer} • {r.class_code || 'No class'} • {r.department} • {r.session_term} {r.session_year}</p>
                {r.request && <p className="text-[11px] italic truncate">“{r.request.reason}”</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                {r.request && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setMode('dismiss'); setTarget(r); }} aria-label="Dismiss request">
                    <X className="w-4 h-4" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive h-8" onClick={() => { setMode('remove'); setTarget(r); if (r.request) setReason(`Trainer request: ${r.request.reason}`); }} aria-label="Remove unit">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === 'dismiss' ? 'Dismiss this request?' : target?.request ? 'Approve removal?' : 'Emergency removal'}</DialogTitle>
            <DialogDescription>
              {target?.unit_code} — {target?.unit_name} for {target?.trainer}.{' '}
              {mode === 'dismiss' ? 'The unit stays on the trainer’s list.' : 'Documents already submitted are not deleted.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'dismiss' ? 'Note to trainer (optional)' : 'Reason (min 5 characters)'} />
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button variant={mode === 'dismiss' ? 'default' : 'destructive'} disabled={busy || (mode === 'remove' && reason.trim().length < 5)} onClick={confirm}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{mode === 'dismiss' ? 'Dismiss request' : 'Remove unit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
