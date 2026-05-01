import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ session: SessionKey; count: number } | null>(null);

  const allowed = activeRole === 'IQA' || activeRole === 'DP_ACADEMICS';

  const { data: counts, refetch } = useQuery({
    enabled: allowed,
    queryKey: ['session-counts', year],
    queryFn: async () => {
      const result: Record<SessionKey, { archived: number; exported: number }> = {
        JAN_APR: { archived: 0, exported: 0 },
        MAY_AUG: { archived: 0, exported: 0 },
        SEP_DEC: { archived: 0, exported: 0 },
      };
      for (const s of SESSIONS) {
        const [{ count: aCount }, { count: eCount }] = await Promise.all([
          supabase
            .from('documents')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'ARCHIVED')
            .eq('session_year' as never, year as never)
            .eq('session_term' as never, s.key as never),
          supabase
            .from('documents')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'EXPORTED')
            .eq('session_year' as never, year as never)
            .eq('session_term' as never, s.key as never),
        ]);
        result[s.key] = { archived: aCount ?? 0, exported: eCount ?? 0 };
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
        body: JSON.stringify({ year, session, deleteAfter }),
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
      const filename = m?.[1] || `EDMS_${year}_${session}.zip`;

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

  return (
    <div className="space-y-4">
      <PageHeader title="Session Exports" subtitle="Download approved documents per training session" />

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Academic Year</span>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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

                <Button
                  className="w-full"
                  disabled={archived === 0 || !!busyKey}
                  onClick={() => runExport(s.key, false)}
                >
                  {busyDl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download ZIP
                </Button>
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={archived === 0 || !!busyKey}
                  onClick={() => setConfirm({ session: s.key, count: archived })}
                >
                  {busyDel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  Download & Free Storage
                </Button>
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
