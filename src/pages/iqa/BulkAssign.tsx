// IQAO / Super Admin — assign one verifier set to multiple packs at once.

import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/sessions';

interface Pack { id: string; department: string; session_year: number; session_term: string; token: string; expires_at: string; revoked_at: string | null; }
interface Verifier { id: string; full_name: string; email: string; organisation: string | null; departments: string[] | null; active: boolean; }

const STATUS_OPTS = ['ACTIVE', 'ALL'] as const;

export default function BulkAssign() {
  const { currentUser, activeRole, loading } = useAuth();
  const [dept, setDept] = useState('ALL');
  const [status, setStatus] = useState<typeof STATUS_OPTS[number]>('ACTIVE');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [verifiers, setVerifiers] = useState<Verifier[]>([]);
  const [selPacks, setSelPacks] = useState<Set<string>>(new Set());
  const [selVerifiers, setSelVerifiers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');

  useEffect(() => {
    if (!canUse) return;
    (async () => {
      setLoadingRows(true);
      // deno-lint-ignore no-explicit-any
      const { data: ps } = await (supabase as any).from('verification_packs').select('*').order('created_at', { ascending: false });
      // deno-lint-ignore no-explicit-any
      const { data: vs } = await (supabase as any).from('verifiers').select('*').eq('active', true).order('full_name');
      setPacks((ps as Pack[]) || []);
      setVerifiers((vs as Verifier[]) || []);
      setLoadingRows(false);
    })();
  }, [canUse]);

  const filteredPacks = useMemo(() => {
    return packs.filter((p) => {
      if (dept !== 'ALL' && p.department !== dept) return false;
      if (status === 'ACTIVE') {
        const active = !p.revoked_at && new Date(p.expires_at) > new Date();
        if (!active) return false;
      }
      return true;
    });
  }, [packs, dept, status]);

  const filteredVerifiers = useMemo(() => {
    if (dept === 'ALL') return verifiers;
    return verifiers.filter((v) => !v.departments || v.departments.length === 0 || v.departments.includes(dept));
  }, [verifiers, dept]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!canUse) return <Navigate to="/" replace />;

  const togglePack = (id: string) => setSelPacks((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleVerifier = (id: string) => setSelVerifiers((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllPacks = () => setSelPacks(new Set(filteredPacks.map((p) => p.id)));
  const clearPacks = () => setSelPacks(new Set());

  const run = async () => {
    if (selPacks.size === 0 || selVerifiers.size === 0) { toast.error('Pick packs and verifiers'); return; }
    setBusy(true);
    const rows: { pack_id: string; verifier_id: string; assigned_by: string }[] = [];
    for (const p of selPacks) for (const v of selVerifiers) rows.push({ pack_id: p, verifier_id: v, assigned_by: currentUser.id });
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any)
      .from('verification_pack_assignees')
      .upsert(rows, { onConflict: 'pack_id,verifier_id', ignoreDuplicates: true });
    setBusy(false);
    if (error) { toast.error('Bulk assign failed', { description: error.message }); return; }
    toast.success(`Assigned ${selVerifiers.size} verifier(s) to ${selPacks.size} pack(s)`);
    setSelPacks(new Set());
    setSelVerifiers(new Set());
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Bulk Assign Verifiers" subtitle="Attach the same verifier set to many packs at once." />

      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof STATUS_OPTS[number])}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Packs ({filteredPacks.length})</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAllPacks}>All</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearPacks}>Clear</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[50vh] overflow-y-auto">
            {loadingRows && <Loader2 className="w-4 h-4 animate-spin" />}
            {filteredPacks.map((p) => {
              const active = !p.revoked_at && new Date(p.expires_at) > new Date();
              return (
                <label key={p.id} className="flex items-start gap-2 border rounded p-2 text-xs">
                  <Checkbox checked={selPacks.has(p.id)} onCheckedChange={() => togglePack(p.id)} />
                  <div className="flex-1">
                    <p className="font-medium">{p.department} · {p.session_year} · {p.session_term}</p>
                    <p className="text-muted-foreground">Expires {new Date(p.expires_at).toLocaleDateString()}</p>
                  </div>
                  {active ? <Badge variant="secondary" className="text-[10px]">Active</Badge> :
                    <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                </label>
              );
            })}
            {!loadingRows && filteredPacks.length === 0 && <p className="text-xs text-muted-foreground">No packs match.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Verifiers ({filteredVerifiers.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 max-h-[50vh] overflow-y-auto">
            {filteredVerifiers.map((v) => (
              <label key={v.id} className="flex items-start gap-2 border rounded p-2 text-xs">
                <Checkbox checked={selVerifiers.has(v.id)} onCheckedChange={() => toggleVerifier(v.id)} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{v.full_name}</p>
                  <p className="text-muted-foreground truncate">{v.email}{v.organisation ? ` · ${v.organisation}` : ''}</p>
                </div>
              </label>
            ))}
            {filteredVerifiers.length === 0 && <p className="text-xs text-muted-foreground">No verifiers.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-16 bg-card border rounded p-3 flex items-center gap-3">
        <div className="text-xs flex-1">
          <p className="font-medium">{selPacks.size} pack(s) × {selVerifiers.size} verifier(s)</p>
          <p className="text-muted-foreground">= {selPacks.size * selVerifiers.size} assignment(s) (duplicates skipped)</p>
        </div>
        <Button onClick={run} disabled={busy || selPacks.size === 0 || selVerifiers.size === 0} className="gap-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Assign
        </Button>
      </div>
    </div>
  );
}
