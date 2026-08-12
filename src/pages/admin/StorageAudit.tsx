import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

const ACTIONS = [
  'ALL',
  'OFFLOADED_TO_DRIVE',
  'OFFLOADED_TO_DRIVE_SCHEDULED',
  'SESSION_EXPORT',
  'SESSION_EXPORT_AND_ERASE',
  'SUPERSEDED_FILES_PURGED',
];

const PURGE_POLICIES = [
  { days: 3, label: 'Aggressive — 3 days' },
  { days: 14, label: 'Balanced — 14 days' },
  { days: 30, label: 'Cautious — 30 days' },
  { days: 90, label: 'Archive-friendly — 90 days' },
];

interface PurgePreview {
  candidates: number;
  graceDays: number;
  oldest?: string | null;
  byDepartment?: { department: string; count: number }[];
}

export default function StorageAudit() {
  const { activeRole } = useAuth();
  const allowed = activeRole === 'IQA' || activeRole === 'SUPER_ADMIN' || activeRole === 'DP_ACADEMICS';
  const [action, setAction] = useState<string>('ALL');
  const [cleaning, setCleaning] = useState<'dry' | 'run' | null>(null);
  const [graceDays, setGraceDays] = useState<number>(() => Number(localStorage.getItem('edms.purgeGraceDays')) || 14);
  const [preview, setPreview] = useState<PurgePreview | null>(null);

  async function runCleanup(dryRun: boolean) {
    setCleaning(dryRun ? 'dry' : 'run');
    localStorage.setItem('edms.purgeGraceDays', String(graceDays));
    try {
      const { data, error } = await supabase.functions.invoke('storage-cleanup', {
        body: { graceDays, dryRun },
      });
      if (error) throw error;
      if (dryRun) {
        setPreview({ candidates: data?.candidates ?? 0, graceDays: data?.graceDays ?? graceDays, oldest: data?.oldest, byDepartment: data?.byDepartment });
        toast.success(`${data?.candidates ?? 0} superseded file(s) older than ${data?.graceDays ?? graceDays} days can be purged`);
      } else {
        setPreview(null);
        toast.success(`Purged ${data?.removed ?? 0} superseded file(s) across ${data?.documents ?? 0} document(s)`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cleanup failed');
    } finally {
      setCleaning(null);
    }
  }


  const { data: rows } = useQuery({
    enabled: allowed,
    queryKey: ['storage-audit', action],
    queryFn: async () => {
      let q = supabase
        .from('audit_logs')
        .select('id, action, created_at, performed_by, document_id, details')
        .order('created_at', { ascending: false })
        .limit(500);
      if (action === 'ALL') q = q.in('action', ACTIONS.slice(1));
      else q = q.eq('action', action);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const userIds = useMemo(() => Array.from(new Set((rows || []).map((r: any) => r.performed_by).filter(Boolean))), [rows]);

  const { data: nameMap } = useQuery({
    enabled: userIds.length > 0,
    queryKey: ['storage-audit-users', userIds.join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const m = new Map<string, string>();
      (data || []).forEach((p: any) => m.set(p.user_id, p.full_name || p.email || 'Unknown'));
      return m;
    },
  });

  if (!allowed) return <Navigate to="/" replace />;

  // Group SESSION_EXPORT rows by (actor + created_at bucketed to 5s) for a nicer summary
  const groups = useMemo(() => {
    const buckets = new Map<string, { key: string; action: string; actor: string; ts: string; count: number; sample: any }>();
    (rows || []).forEach((r: any) => {
      const bucket = `${r.action}|${r.performed_by}|${new Date(r.created_at).toISOString().slice(0, 16)}`;
      const cur = buckets.get(bucket);
      if (cur) cur.count += 1;
      else buckets.set(bucket, { key: bucket, action: r.action, actor: r.performed_by, ts: r.created_at, count: 1, sample: r.details });
    });
    return Array.from(buckets.values()).sort((a, b) => b.ts.localeCompare(a.ts));
  }, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage & Export Audit"
        subtitle="Every offload and session export — who ran it, when, and how many files"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reclaim storage from corrected documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Deletes the superseded file of any document that was rejected and later corrected, once the corrected
            version is older than the retention window below. The rejection history, reasons and dates are kept in full.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium mb-1">Retention window</p>
              <Select value={String(graceDays)} onValueChange={(v) => setGraceDays(Number(v))}>
                <SelectTrigger className="h-11 sm:h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURGE_POLICIES.map((p) => (
                    <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="h-11 sm:h-9" disabled={!!cleaning} onClick={() => runCleanup(true)}>
              {cleaning === 'dry' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Dry-run report
            </Button>
            <Button variant="destructive" className="h-11 sm:h-9" disabled={!!cleaning || !preview} onClick={() => runCleanup(false)}>
              {cleaning === 'run' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Purge superseded files
            </Button>
          </div>
          {!preview && <p className="text-[11px] text-muted-foreground">Run the dry-run report first to see exactly what would be deleted.</p>}
          {preview && (
            <div className="rounded-md border p-3 text-xs space-y-1">
              <p className="font-medium">
                {preview.candidates} superseded file(s) older than {preview.graceDays} day(s) can be purged
              </p>
              {preview.oldest && <p className="text-muted-foreground">Oldest candidate: {new Date(preview.oldest).toLocaleDateString()}</p>}
              {(preview.byDepartment || []).map((d) => (
                <div key={d.department} className="flex justify-between text-muted-foreground">
                  <span className="truncate">{d.department}</span><span>{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Action</span>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a === 'ALL' ? 'All storage/export actions' : a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        {groups.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No entries yet</CardContent></Card>
        )}
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge variant="outline">{g.action}</Badge>
                <span className="text-muted-foreground">{new Date(g.ts).toLocaleString()}</span>
              </CardTitle>
              <span className="text-sm font-semibold">{g.count} file{g.count === 1 ? '' : 's'}</span>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div><strong>By:</strong> {nameMap?.get(g.actor) || g.actor || 'system/cron'}</div>
              {g.sample?.department && <div><strong>Department:</strong> {g.sample.department}</div>}
              {g.sample?.session_year && <div><strong>Session:</strong> {g.sample.session_term} {g.sample.session_year}</div>}
              {g.sample?.originals_deleted !== undefined && (
                <div><strong>Originals deleted:</strong> {g.sample.originals_deleted ? 'Yes' : 'No'}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
