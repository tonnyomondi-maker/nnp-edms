import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Download, Archive, Loader2, FileArchive } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

type SessionKey = 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC';

const SESSIONS: { key: SessionKey; label: string; months: string }[] = [
  { key: 'JAN_APR', label: 'January – April', months: 'January – April' },
  { key: 'MAY_AUG', label: 'May – August', months: 'May – August' },
  { key: 'SEP_DEC', label: 'September – December', months: 'September – December' },
];

function sessionRange(year: number, session: SessionKey) {
  if (session === 'JAN_APR') return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 4, 1)) };
  if (session === 'MAY_AUG') return { start: new Date(Date.UTC(year, 4, 1)), end: new Date(Date.UTC(year, 8, 1)) };
  return { start: new Date(Date.UTC(year, 8, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

export default function SessionExports() {
  const { activeRole } = useAuth();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [department, setDepartment] = useState<string>('ALL');
  const [trainerId, setTrainerId] = useState<string>('ALL');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ session: SessionKey; count: number } | null>(null);

  const allowed = activeRole === 'IQA' || activeRole === 'DP_ACADEMICS' || activeRole === 'SUPER_ADMIN';

  const { data: departments } = useQuery({
    enabled: allowed,
    queryKey: ['export-departments'],
    queryFn: async () => {
      const { data } = await supabase.from('documents').select('department').eq('status', 'ARCHIVED');
      return Array.from(new Set((data || []).map((d: any) => d.department).filter(Boolean))).sort();
    },
  });

  const { data: trainers } = useQuery({
    enabled: allowed && department !== 'ALL',
    queryKey: ['export-trainers', department],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('trainer_id, profiles:trainer_id(full_name)')
        .eq('status', 'ARCHIVED')
        .eq('department', department);
      const map = new Map<string, string>();
      (data || []).forEach((d: any) => {
        if (d.trainer_id) map.set(d.trainer_id, d.profiles?.full_name || 'Unknown');
      });
      return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const { data: counts, refetch } = useQuery({
    enabled: allowed,
    queryKey: ['session-counts', year, department, trainerId],
    queryFn: async () => {
      const result: Record<SessionKey, { archived: number; exported: number; needsMirror: number }> = {
        JAN_APR: { archived: 0, exported: 0, needsMirror: 0 },
        MAY_AUG: { archived: 0, exported: 0, needsMirror: 0 },
        SEP_DEC: { archived: 0, exported: 0, needsMirror: 0 },
      };
      for (const s of SESSIONS) {
        const base = () => {
          let q = supabase
            .from('documents')
            .select('id', { count: 'exact', head: true })
            .eq('session_year' as never, year as never)
            .eq('session_term' as never, s.key as never);
          if (department !== 'ALL') q = q.eq('department', department);
          if (trainerId !== 'ALL') q = q.eq('trainer_id', trainerId);
          return q;
        };
        const [{ count: aCount }, { count: eCount }, { count: mCount }] = await Promise.all([
          base().eq('status', 'ARCHIVED'),
          base().eq('status', 'EXPORTED'),
          base().eq('status', 'ARCHIVED').is('gdrive_file_id' as never, null as never),
        ]);
        result[s.key] = { archived: aCount ?? 0, exported: eCount ?? 0, needsMirror: mCount ?? 0 };
      }
      return result;
    },
  });

  const yearOptions = useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear, currentYear + 1].sort((a, b) => b - a),
    [currentYear],
  );

  if (!allowed) return <Navigate to="/" replace />;


  async function runExport(session: SessionKey, deleteAfter: boolean) {
    const key = `${session}-${deleteAfter ? 'del' : 'keep'}`;
    setBusyKey(key);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Not authenticated');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-session-zip`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          year, session, deleteAfter,
          department: department === 'ALL' ? undefined : department,
          trainerId: trainerId === 'ALL' ? undefined : trainerId,
          nested: true,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        let msg = txt;
        try { msg = JSON.parse(txt).error || txt; } catch { /* not JSON */ }
        throw new Error(msg || `Export failed (${resp.status})`);
      }

      const included = resp.headers.get('X-Included') || '?';
      const blob = await resp.blob();
      const dispo = resp.headers.get('Content-Disposition') || '';
      const m = dispo.match(/filename="([^"]+)"/);
      const scope = trainerId !== 'ALL' ? `_${trainerId.slice(0, 6)}` : department !== 'ALL' ? `_${department}` : '';
      const filename = m?.[1] || `EDMS_${year}_${session}${scope}.zip`;

      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      toast.success(`Exported ${included} document(s)${deleteAfter ? ' and freed cloud storage' : ''}`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusyKey(null);
      setConfirm(null);
    }
  }

  async function offloadToDrive() {
    if (department === 'ALL') {
      toast.error('Choose a department to offload');
      return;
    }
    setBusyKey('offload');
    try {
      const { data, error } = await supabase.functions.invoke('offload-to-drive', {
        body: { department, sessionYear: year },
      });
      if (error) throw error;
      toast.success(`Offloaded ${data?.offloaded ?? 0} of ${data?.total ?? 0} document(s) to Google Drive`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Offload failed');
    } finally {
      setBusyKey(null);
    }
  }


  return (
    <div className="space-y-4">
      <PageHeader title="Session Exports" subtitle="Download approved documents per training session" />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Academic Year</span>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">Department</span>
        <Select value={department} onValueChange={(v) => { setDepartment(v); setTrainerId('ALL'); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All departments</SelectItem>
            {(departments || []).map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">Trainer</span>
        <Select value={trainerId} onValueChange={setTrainerId} disabled={department === 'ALL'}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All trainers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All trainers</SelectItem>
            {(trainers || []).map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ActionGuardButton
          action="export"
          variant="outline"
          disabled={department === 'ALL' || busyKey === 'offload'}
          onClick={offloadToDrive}
        >
          {busyKey === 'offload' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
          Offload dept. to Google Drive
        </ActionGuardButton>
      </div>


      <div className="grid gap-4 md:grid-cols-3">
        {SESSIONS.map((s) => {
          const c = counts?.[s.key];
          const archived = c?.archived ?? 0;
          const exported = c?.exported ?? 0;
          const busyDl = busyKey === `${s.key}-keep`;
          const busyDel = busyKey === `${s.key}-del`;
          return (
            <Card key={s.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileArchive className="w-4 h-4 text-primary" />
                  {s.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{s.months} {year}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Ready to export</span>
                  <span className="font-semibold">{archived}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Already exported</span>
                  <span className="font-semibold">{exported}</span>
                </div>

                <ActionGuardButton
                  action="export"
                  className="w-full"
                  disabled={archived === 0 || !!busyKey}
                  onClick={() => runExport(s.key, false)}
                >
                  {busyDl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download ZIP
                </ActionGuardButton>
                <ActionGuardButton
                  action="export"
                  className="w-full"
                  variant="destructive"
                  disabled={archived === 0 || !!busyKey}
                  onClick={() => setConfirm({ session: s.key, count: archived })}
                >
                  {busyDel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  Download & Free Storage
                </ActionGuardButton>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Free cloud storage?</AlertDialogTitle>
            <AlertDialogDescription>
              This will download a ZIP of {confirm?.count} archived document(s) and then permanently
              delete the original PDF files from cloud storage. The database records (with full audit
              trail) are kept and marked as <strong>Exported</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyKey}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm && runExport(confirm.session, true)}
              disabled={!!busyKey}
            >
              {busyKey ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Download & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
