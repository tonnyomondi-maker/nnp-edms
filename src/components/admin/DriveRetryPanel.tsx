// Super Admin recovery panel: re-run failed Google Drive mirrors and failed ZIP
// exports without touching credentials — the linked workspace connection is
// reused as-is. Also lets an admin push any approved/archived document that has
// never reached Drive so final copies are always stored there.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, RotateCw, XCircle } from 'lucide-react';

const APPROVED_STATES = ['DP_APPROVED', 'ARCHIVED', 'EXPORTED'];

interface DocRow {
  id: string;
  file_name: string;
  department: string;
  trainer_id: string;
  status: string;
  gdrive_sync_status: string | null;
  gdrive_last_error: string | null;
  gdrive_last_attempt_at: string | null;
  gdrive_file_id: string | null;
}

interface JobRow {
  id: string;
  job_id: string;
  kind: string;
  department: string | null;
  session_year: number | null;
  session_term: string | null;
  phase: string;
  message: string | null;
  processed: number;
  total: number;
  updated_at: string;
}

type Outcome = 'ok' | 'fail';

export function DriveRetryPanel() {
  const [failed, setFailed] = useState<DocRow[]>([]);
  const [unmirrored, setUnmirrored] = useState<DocRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Record<string, { outcome: Outcome; message?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: failedDocs }, { data: pendingDocs }, { data: jobRows }] = await Promise.all([
      supabase
        .from('documents')
        .select('id, file_name, department, trainer_id, status, gdrive_sync_status, gdrive_last_error, gdrive_last_attempt_at, gdrive_file_id')
        .eq('gdrive_sync_status', 'failed')
        .order('gdrive_last_attempt_at', { ascending: false })
        .limit(200),
      supabase
        .from('documents')
        .select('id, file_name, department, trainer_id, status, gdrive_sync_status, gdrive_last_error, gdrive_last_attempt_at, gdrive_file_id')
        .in('status', APPROVED_STATES as never)
        .is('gdrive_file_id', null)
        .neq('gdrive_sync_status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('export_progress')
        .select('*')
        .in('phase', ['error', 'failed'])
        .order('updated_at', { ascending: false })
        .limit(25),
    ]);

    const f = (failedDocs || []) as unknown as DocRow[];
    const u = (pendingDocs || []) as unknown as DocRow[];
    setFailed(f);
    setUnmirrored(u);
    setJobs(((jobRows || []) as unknown as JobRow[]));

    const ids = Array.from(new Set([...f, ...u].map((d) => d.trainer_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: { user_id: string; full_name: string }) => { map[p.user_id] = p.full_name; });
      setNames(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const mirrorOne = async (doc: DocRow): Promise<Outcome> => {
    try {
      const { data, error } = await supabase.functions.invoke('gdrive-upload', { body: { documentId: doc.id } });
      const msg = error?.message || (data as { error?: string } | null)?.error;
      if (msg) {
        setResults((r) => ({ ...r, [doc.id]: { outcome: 'fail', message: msg } }));
        return 'fail';
      }
      setResults((r) => ({ ...r, [doc.id]: { outcome: 'ok' } }));
      return 'ok';
    } catch (e) {
      setResults((r) => ({ ...r, [doc.id]: { outcome: 'fail', message: (e as Error).message } }));
      return 'fail';
    }
  };

  const retryOne = async (doc: DocRow) => {
    setBusyId(doc.id);
    const outcome = await mirrorOne(doc);
    setBusyId(null);
    if (outcome === 'ok') toast({ title: 'Mirrored to Google Drive', description: doc.file_name });
    else toast({ title: 'Drive sync failed again', description: doc.file_name, variant: 'destructive' });
    await load();
  };

  const retryMany = async (docs: DocRow[], label: string) => {
    if (docs.length === 0) return;
    setBulk({ done: 0, total: docs.length });
    let ok = 0;
    for (let i = 0; i < docs.length; i++) {
      const outcome = await mirrorOne(docs[i]);
      if (outcome === 'ok') ok++;
      setBulk({ done: i + 1, total: docs.length });
    }
    setBulk(null);
    toast({
      title: `${label}: ${ok}/${docs.length} mirrored`,
      description: ok === docs.length ? 'All copies are now stored in Google Drive.' : 'Some documents still failed — see the list.',
      variant: ok === docs.length ? 'default' : 'destructive',
    });
    await load();
  };

  const rerunExport = async (job: JobRow) => {
    if (!job.session_year || !job.session_term) {
      toast({ title: 'Cannot re-run', description: 'This job has no session recorded.', variant: 'destructive' });
      return;
    }
    setBusyId(job.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-session-zip`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({
          year: job.session_year,
          session: job.session_term,
          deleteAfter: false,
          department: job.department || undefined,
          nested: true,
          jobId: `retry_${job.job_id}_${Date.now()}`,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        let msg = txt;
        try { msg = JSON.parse(txt).error || txt; } catch { /* not JSON */ }
        throw new Error(msg || `Export failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EDMS_${job.session_year}_${job.session_term}${job.department ? `_${job.department}` : ''}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Export re-run complete' });
      await load();
    } catch (e) {
      toast({ title: 'Export re-run failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const pendingApproved = useMemo(
    () => unmirrored.filter((d) => APPROVED_STATES.includes(d.status)),
    [unmirrored],
  );

  const nothingPending = failed.length === 0 && pendingApproved.length === 0 && jobs.length === 0;

  const row = (doc: DocRow, tone: 'fail' | 'pending') => {
    const res = results[doc.id];
    return (
      <div key={doc.id} className="flex flex-wrap items-center gap-2 border rounded px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{doc.file_name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {doc.department} · {names[doc.trainer_id] || doc.trainer_id.slice(0, 8)} · {doc.status}
            {doc.gdrive_last_attempt_at && <> · last try {new Date(doc.gdrive_last_attempt_at).toLocaleString()}</>}
          </div>
          {tone === 'fail' && doc.gdrive_last_error && (
            <div className="text-xs text-destructive truncate" title={doc.gdrive_last_error}>{doc.gdrive_last_error}</div>
          )}
          {res?.outcome === 'fail' && res.message && (
            <div className="text-xs text-destructive truncate" title={res.message}>Retry error: {res.message}</div>
          )}
        </div>
        {res?.outcome === 'ok' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        {res?.outcome === 'fail' && <XCircle className="w-4 h-4 text-destructive" />}
        <Button size="sm" variant="outline" className="gap-1" disabled={busyId === doc.id || !!bulk} onClick={() => retryOne(doc)}>
          {busyId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
          Retry
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Failed Drive syncs &amp; exports</CardTitle>
        <div className="flex items-center gap-2">
          {bulk && <span className="text-xs text-muted-foreground">{bulk.done}/{bulk.total} retried</span>}
          <Button size="sm" variant="outline" onClick={load} disabled={loading || !!bulk}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : nothingPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            All approved documents are mirrored and no export job has failed.
          </div>
        ) : (
          <>
            {failed.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> Failed mirrors
                    <Badge variant="destructive" className="text-[10px]">{failed.length}</Badge>
                  </span>
                  <Button size="sm" className="gap-1" disabled={!!bulk} onClick={() => retryMany(failed, 'Retry all')}>
                    {bulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                    Retry all
                  </Button>
                </div>
                <div className="space-y-1">{failed.map((d) => row(d, 'fail'))}</div>
              </div>
            )}

            {pendingApproved.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">
                    Approved but not yet in Drive{' '}
                    <Badge variant="secondary" className="text-[10px]">{pendingApproved.length}</Badge>
                  </span>
                  <Button size="sm" variant="secondary" className="gap-1" disabled={!!bulk}
                    onClick={() => retryMany(pendingApproved, 'Sync all approved')}>
                    {bulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    Sync all approved documents
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Final approved copies are filed under <span className="font-mono">EDMS / Session / Department / Trainer</span>.
                </p>
                <div className="space-y-1">{pendingApproved.map((d) => row(d, 'pending'))}</div>
              </div>
            )}

            {jobs.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold">
                  Failed ZIP exports <Badge variant="destructive" className="text-[10px]">{jobs.length}</Badge>
                </span>
                <div className="space-y-1">
                  {jobs.map((j) => (
                    <div key={j.id} className="flex flex-wrap items-center gap-2 border rounded px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {j.session_term ? `${j.session_term} ${j.session_year}` : j.kind} {j.department ? `· ${j.department}` : '· all departments'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {j.processed}/{j.total} processed · {new Date(j.updated_at).toLocaleString()}
                        </div>
                        {j.message && <div className="text-xs text-destructive truncate" title={j.message}>{j.message}</div>}
                      </div>
                      <Button size="sm" variant="outline" className="gap-1" disabled={busyId === j.id} onClick={() => rerunExport(j)}>
                        {busyId === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        Re-run export
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
