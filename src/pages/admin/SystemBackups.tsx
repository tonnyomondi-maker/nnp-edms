import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Archive, RotateCcw, Database, Plus, Eye, Lock, AlertTriangle } from 'lucide-react';

interface BackupRow {
  id: string;
  snapshot_key: string;
  created_at: string;
  created_by_email: string | null;
  documents_count: number;
  audit_logs_count: number;
  storage_files_count: number;
  total_bytes: number;
  note: string | null;
}

interface TableDiff {
  table: string;
  wiped_before_restore: boolean;
  snapshot_rows: number;
  current_rows: number;
  will_overwrite: number;
  will_insert_new: number;
  will_delete: number;
  will_remain_untouched: number;
  sample_overwrite_ids: string[];
  sample_new_ids: string[];
}
interface DryRun {
  manifest: Record<string, unknown>;
  table_diffs: TableDiff[];
  storage: { snapshot_files: number; current_files: number; will_overwrite_or_create: number; note: string };
  summary: { total_will_overwrite: number; total_will_insert: number; total_will_delete: number };
}

function fmt(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

export default function SystemBackups() {
  const { currentUser, activeRole, loading } = useAuth();
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [restoreFor, setRestoreFor] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState('');
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [dryRunKey, setDryRunKey] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [lockState, setLockState] = useState<{ lock_active: boolean; lock_reason: string | null } | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from('backup_metadata' as never).select('*')
      .order('created_at', { ascending: false });
    setRows((data as never) || []);
    const { data: ls } = await supabase
      .from('system_settings' as never).select('lock_active,lock_reason').eq('id' as never, 1 as never).maybeSingle();
    setLockState((ls as never) ?? null);
  };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  if (loading) return null;
  if (!currentUser?.roles.includes('SUPER_ADMIN')) return <Navigate to="/" replace />;
  if (activeRole !== 'SUPER_ADMIN') {
    return <div className="p-4"><Card><CardContent className="p-4 text-sm text-muted-foreground">Switch to <strong>Super Admin</strong> to manage backups.</CardContent></Card></div>;
  }

  const createBackup = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('backup-system', { body: { note: note || null, includeFiles: true } });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Backup failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
    } else {
      toast({ title: 'Backup created', description: (data as { snapshot_key: string }).snapshot_key });
      setNote('');
      load();
    }
  };

  const previewRestore = async (key: string) => {
    setDryRunLoading(true);
    setDryRunKey(key);
    setDryRun(null);
    const { data, error } = await supabase.functions.invoke('restore-system-dryrun', { body: { snapshot_key: key } });
    setDryRunLoading(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Preview failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
      setDryRunKey(null);
    } else {
      setDryRun(data as DryRun);
    }
  };

  const restore = async (key: string) => {
    if (restoreText !== `RESTORE ${key}`) {
      toast({ title: 'Confirmation mismatch', description: `Type exactly: RESTORE ${key}`, variant: 'destructive' });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('restore-system', { body: { snapshot_key: key, confirm: restoreText } });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Restore failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
    } else {
      toast({ title: 'System restored', description: `From ${key}` });
      setRestoreFor(null); setRestoreText(''); setDryRun(null); setDryRunKey(null); load();
    }
  };

  const toggleLock = async (active: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('system-lock', {
      body: { active, reason: active ? 'Manual safety lock' : null },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Lock change failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
    } else {
      toast({ title: active ? 'System locked' : 'System unlocked' });
      load();
    }
  };

  return (
    <div className="space-y-3 pb-8">
      <PageHeader title="System Backups" subtitle="Create snapshots, preview restores safely, manage the safety lock" />

      {/* Manual safety lock toggle */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="w-4 h-4" />Safety Lock</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            When the lock is ON, trainers cannot upload and HOD/DP/IQA cannot approve. The lock is engaged automatically during SYSTEM_RESET and SYSTEM_RESTORED. You can also engage it manually before risky maintenance.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={lockState?.lock_active ? 'destructive' : 'secondary'}>
              {lockState?.lock_active ? 'LOCKED' : 'Unlocked'}
            </Badge>
            {lockState?.lock_reason && <span className="text-xs text-muted-foreground">"{lockState.lock_reason}"</span>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={lockState?.lock_active ? 'outline' : 'destructive'} onClick={() => toggleLock(!lockState?.lock_active)} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {lockState?.lock_active ? 'Unlock system' : 'Engage lock'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" />New Backup</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea placeholder="Optional note (e.g. 'Pre-Term-2 reset')" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <Button onClick={createBackup} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Archive className="w-4 h-4 mr-2" />
            Create snapshot (tables + files)
          </Button>
          <p className="text-xs text-muted-foreground">
            Snapshots include documents, audit logs, role changes, profiles, user roles, teaching assignments, unit configs and every file in the documents bucket.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />Available Snapshots</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No backups yet.</p>}
          {rows.map((r) => (
            <div key={r.id} className="border rounded p-3 space-y-2">
              <div className="flex justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-medium">{r.snapshot_key}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} · {r.created_by_email}
                  </div>
                  {r.note && <div className="text-xs italic mt-1">"{r.note}"</div>}
                </div>
                <div className="flex flex-wrap gap-1 items-start">
                  <Badge variant="secondary" className="text-[10px]">{r.documents_count} docs</Badge>
                  <Badge variant="secondary" className="text-[10px]">{r.audit_logs_count} logs</Badge>
                  <Badge variant="secondary" className="text-[10px]">{r.storage_files_count} files</Badge>
                  <Badge variant="secondary" className="text-[10px]">{fmt(r.total_bytes)}</Badge>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => previewRestore(r.snapshot_key)} disabled={dryRunLoading && dryRunKey === r.snapshot_key}>
                  {dryRunLoading && dryRunKey === r.snapshot_key ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
                  Preview restore (dry-run)
                </Button>
                {restoreFor !== r.snapshot_key && (
                  <Button size="sm" variant="outline" onClick={() => { setRestoreFor(r.snapshot_key); setRestoreText(''); }}>
                    <RotateCcw className="w-4 h-4 mr-1" />Restore from this snapshot
                  </Button>
                )}
              </div>

              {/* Dry-run results for this snapshot */}
              {dryRunKey === r.snapshot_key && dryRun && (
                <div className="border-t pt-2 space-y-2">
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Dry-run preview — nothing has been changed yet.
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    <Badge variant="outline">{dryRun.summary.total_will_overwrite} will be overwritten</Badge>
                    <Badge variant="outline">{dryRun.summary.total_will_insert} will be inserted</Badge>
                    <Badge variant="destructive">{dryRun.summary.total_will_delete} will be deleted</Badge>
                    <Badge variant="outline">{dryRun.storage.will_overwrite_or_create} files affected</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-[11px] w-full">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left py-1 pr-2">Table</th>
                          <th className="text-right pr-2">Snapshot</th>
                          <th className="text-right pr-2">Current</th>
                          <th className="text-right pr-2">Overwrite</th>
                          <th className="text-right pr-2">New</th>
                          <th className="text-right pr-2">Delete</th>
                          <th className="text-right pr-2">Untouched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dryRun.table_diffs.map((d) => (
                          <tr key={d.table} className="border-t">
                            <td className="py-1 pr-2 font-medium">{d.table}{d.wiped_before_restore && <span className="ml-1 text-destructive">⚠</span>}</td>
                            <td className="text-right pr-2">{d.snapshot_rows}</td>
                            <td className="text-right pr-2">{d.current_rows}</td>
                            <td className="text-right pr-2">{d.will_overwrite}</td>
                            <td className="text-right pr-2 text-emerald-700 dark:text-emerald-300">+{d.will_insert_new}</td>
                            <td className="text-right pr-2 text-destructive">−{d.will_delete}</td>
                            <td className="text-right pr-2 text-muted-foreground">{d.will_remain_untouched}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-muted-foreground">⚠ = table is fully wiped first (any current row not in the snapshot is permanently deleted). Files: {dryRun.storage.note}</p>
                </div>
              )}

              {restoreFor === r.snapshot_key && (
                <div className="space-y-2 border-t pt-2">
                  <p className="text-xs text-destructive">
                    This wipes current documents, audit logs, configs &amp; assignments and replaces them with the snapshot. Storage files are upserted. The system safety lock will engage automatically.
                  </p>
                  <p className="text-xs">Type exactly: <code className="bg-muted px-1 rounded">RESTORE {r.snapshot_key}</code></p>
                  <Input value={restoreText} onChange={(e) => setRestoreText(e.target.value)} placeholder={`RESTORE ${r.snapshot_key}`} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => restore(r.snapshot_key)} disabled={busy || restoreText !== `RESTORE ${r.snapshot_key}`}>
                      {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Confirm restore
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setRestoreFor(null); setRestoreText(''); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
