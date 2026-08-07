import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, XCircle, RefreshCw, PlayCircle, FolderCog, Search } from 'lucide-react';

type Step = { name: string; ok?: boolean; latency_ms?: number; detail?: unknown };
type Run = {
  id: string;
  kind: 'healthcheck' | 'smoke_test';
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  steps: Step[];
  error: string | null;
};
type FolderRow = { id: string; scope: string; department: string | null; folder_id: string; folder_name: string | null; updated_at: string };

function StatusPill({ ok }: { ok: boolean }) {
  return ok
    ? <Badge className="bg-green-600 hover:bg-green-600 gap-1"><CheckCircle2 className="w-3 h-3" />OK</Badge>
    : <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Fail</Badge>;
}

export default function IntegrationHealth() {
  const { currentUser, activeRole } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState({ health: false, smoke: false, relink: false });
  const [rootName, setRootName] = useState('EDMS');
  const [discovered, setDiscovered] = useState<{ scope: string; department: string | null; folder_id: string; folder_name: string }[] | null>(null);

  const isSuper = activeRole === 'SUPER_ADMIN';

  async function refresh() {
    const [{ data: r }, { data: f }] = await Promise.all([
      supabase.from('integration_health_runs').select('*').order('started_at', { ascending: false }).limit(20),
      supabase.from('drive_folder_map').select('*').order('scope').order('department'),
    ]);
    setRuns(((r ?? []) as unknown) as Run[]);
    setFolders((f ?? []) as FolderRow[]);
  }

  useEffect(() => { if (isSuper) refresh(); }, [isSuper]);

  async function invoke(name: 'drive-healthcheck' | 'drive-smoke-test' | 'drive-relink-folders', body?: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} });
    if (error) throw new Error(error.message);
    return data;
  }

  async function runHealth() {
    setLoading((s) => ({ ...s, health: true }));
    try {
      const d = await invoke('drive-healthcheck');
      toast({ title: d.ok ? 'Health check passed' : 'Health check failed', variant: d.ok ? 'default' : 'destructive' });
      await refresh();
    } catch (e) {
      toast({ title: 'Health check error', description: String(e), variant: 'destructive' });
    } finally { setLoading((s) => ({ ...s, health: false })); }
  }

  async function runSmoke(multi: boolean) {
    setLoading((s) => ({ ...s, smoke: true }));
    try {
      const depts = multi ? (selectedDepts.length ? selectedDepts : mappedDepartments) : [];
      if (multi && depts.length === 0) {
        toast({ title: 'No departments selected', description: 'Map or pick at least one department first.', variant: 'destructive' });
        return;
      }
      const d = await invoke('drive-smoke-test', multi ? { departments: depts } : {});
      toast({
        title: d.ok ? 'Smoke test passed' : 'Smoke test failed',
        description: d.error ?? (multi ? `${depts.length} department(s) tested` : undefined),
        variant: d.ok ? 'default' : 'destructive',
      });
      await refresh();
    } catch (e) {
      toast({ title: 'Smoke test error', description: String(e), variant: 'destructive' });
    } finally { setLoading((s) => ({ ...s, smoke: false })); }
  }


  async function relink(mode: 'discover' | 'create') {
    if (mode === 'create' && !confirm('Create/overwrite the Drive folder map for this workspace?')) return;
    setLoading((s) => ({ ...s, relink: true }));
    try {
      const d = await invoke('drive-relink-folders', { mode, rootFolderName: rootName });
      if (mode === 'discover') { setDiscovered(d.map ?? []); toast({ title: `Discovered ${d.map?.length ?? 0} folders` }); }
      else { setDiscovered(null); toast({ title: 'Folder map updated' }); await refresh(); }
    } catch (e) {
      toast({ title: 'Re-link failed', description: String(e), variant: 'destructive' });
    } finally { setLoading((s) => ({ ...s, relink: false })); }
  }

  if (!currentUser) return null;
  if (!isSuper) {
    return (
      <div className="p-4">
        <PageHeader title="Integration Health" subtitle="Super Admin only" />
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Switch to the Super Admin role to view this page.</CardContent></Card>
      </div>
    );
  }

  const envRow = (runs.find((r) => r.kind === 'healthcheck')?.steps ?? []).find((s) => s.name === 'env_vars');
  const env = (envRow?.detail as Record<string, boolean> | undefined) ?? {};
  const envKeys = ['LOVABLE_API_KEY', 'GOOGLE_DRIVE_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'];

  const lastHealth = runs.find((r) => r.kind === 'healthcheck');
  const lastSmoke = runs.find((r) => r.kind === 'smoke_test');

  return (
    <div className="p-4 pb-24 space-y-4">
      <PageHeader title="Integration Health" subtitle="Google Drive connection status, folders, and smoke tests" />

      <div className="flex flex-wrap gap-2">
        <Button onClick={runHealth} disabled={loading.health} className="gap-2">
          {loading.health ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Run health check
        </Button>
        <Button onClick={runSmoke} disabled={loading.smoke} variant="secondary" className="gap-2">
          {loading.smoke ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          Run smoke test
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Environment variables</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {envKeys.map((k) => (
            <div key={k} className="flex items-center justify-between border rounded px-3 py-2">
              <span className="font-mono text-xs">{k}</span>
              {envRow ? <StatusPill ok={!!env[k]} /> : <span className="text-muted-foreground text-xs">Run health check</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Drive API status</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {lastHealth ? (() => {
            const about = lastHealth.steps.find((s) => s.name === 'drive_about');
            const d = about?.detail as any;
            return (
              <>
                <div className="flex items-center gap-2">
                  <StatusPill ok={!!about?.ok} />
                  <span className="text-xs text-muted-foreground">Latency: {about?.latency_ms ?? '—'} ms</span>
                </div>
                {about?.ok && d?.body?.user && (
                  <div className="text-xs">
                    Account: <span className="font-mono">{d.body.user.emailAddress}</span>
                    {d.body.storageQuota && (
                      <> — {(Number(d.body.storageQuota.usage ?? 0) / 1e9).toFixed(2)} GB used
                        {d.body.storageQuota.limit ? ` / ${(Number(d.body.storageQuota.limit) / 1e9).toFixed(2)} GB` : ''}
                      </>
                    )}
                  </div>
                )}
                {!about?.ok && <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(d, null, 2)}</pre>}
              </>
            );
          })() : <span className="text-muted-foreground text-xs">Run health check to populate.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Folder map</CardTitle>
          <div className="flex items-center gap-2">
            <Input value={rootName} onChange={(e) => setRootName(e.target.value)} className="h-8 w-32 text-xs" />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => relink('discover')} disabled={loading.relink}>
              <Search className="w-3 h-3" />Discover
            </Button>
            <Button size="sm" className="gap-1" onClick={() => relink('create')} disabled={loading.relink}>
              <FolderCog className="w-3 h-3" />Re-link
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {folders.length === 0 && <div className="text-muted-foreground text-xs">No folders mapped. Click "Discover" then "Re-link".</div>}
          {folders.map((f) => {
            const check = (lastHealth?.steps.find((s) => s.name === 'folders')?.detail as any[] | undefined)
              ?.find((x) => x.folder_id === f.folder_id);
            return (
              <div key={f.id} className="flex items-center justify-between border rounded px-3 py-2">
                <div>
                  <div className="font-medium">{f.scope === 'root' ? 'Root' : f.department}</div>
                  <div className="text-xs text-muted-foreground font-mono">{f.folder_name} · {f.folder_id}</div>
                </div>
                {check ? (
                  <div className="flex gap-1">
                    <StatusPill ok={!!check.ok} />
                    {check.writable ? <Badge variant="secondary" className="text-xs">writable</Badge> : <Badge variant="outline" className="text-xs">read-only</Badge>}
                  </div>
                ) : <span className="text-xs text-muted-foreground">unchecked</span>}
              </div>
            );
          })}

          {discovered && (
            <div className="mt-4 border-t pt-3">
              <div className="text-xs font-medium mb-2">Discovery preview ({discovered.length} folders):</div>
              <div className="space-y-1 text-xs">
                {discovered.map((d, i) => (
                  <div key={i} className="flex justify-between font-mono">
                    <span>{d.scope === 'root' ? '/' : `/${d.department}`}</span>
                    <span className="text-muted-foreground">{d.folder_id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Last smoke test</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {lastSmoke ? (
            <>
              <div className="flex items-center gap-2">
                <StatusPill ok={lastSmoke.status === 'success'} />
                <span className="text-xs text-muted-foreground">{new Date(lastSmoke.started_at).toLocaleString()}</span>
              </div>
              {lastSmoke.error && <div className="text-xs text-destructive">{lastSmoke.error}</div>}
              <div className="space-y-1">
                {lastSmoke.steps.map((s, i) => (
                  <div key={i} className="flex justify-between text-xs border-b py-1">
                    <span className="font-mono">{s.name}</span>
                    <span className="flex items-center gap-2">
                      {s.latency_ms != null && <span className="text-muted-foreground">{s.latency_ms}ms</span>}
                      {s.ok === true ? <CheckCircle2 className="w-3 h-3 text-green-600" /> :
                        s.ok === false ? <XCircle className="w-3 h-3 text-destructive" /> : null}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : <span className="text-muted-foreground text-xs">No smoke test has been run yet.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {runs.slice(0, 10).map((r) => (
            <div key={r.id} className="flex justify-between border-b py-1">
              <span className="font-mono">{r.kind}</span>
              <span className="text-muted-foreground">{new Date(r.started_at).toLocaleString()}</span>
              <StatusPill ok={r.status === 'success'} />
            </div>
          ))}
          {runs.length === 0 && <span className="text-muted-foreground">Nothing yet.</span>}
        </CardContent>
      </Card>
    </div>
  );
}
