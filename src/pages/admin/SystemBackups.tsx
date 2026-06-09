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
import { Loader2, Archive, RotateCcw, Database, Plus } from 'lucide-react';

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

  const load = async () => {
    const { data } = await supabase
      .from('backup_metadata' as never).select('*')
      .order('created_at', { ascending: false });
    setRows((data as never) || []);
  };
  useEffect(() => { load(); }, []);

  if (loading) return null;
  if (!currentUser?.roles.includes('SUPER_ADMIN')) return <Navigate to="/" replace />;
  if (activeRole !== 'SUPER_ADMIN') {
    return <div className="p-4"><Card><CardContent className="p-4 text-sm text-muted-foreground">Switch to <strong>Super Admin</strong> to manage backups.</CardContent></Card></div>;
  }

  const createBackup = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('backup-system', { body: { note: note || null, includeFiles: true } });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast({ title: 'Backup failed', description: error?.message || (data as any)?.error, variant: 'destructive' });
    } else {
      toast({ title: 'Backup created', description: (data as any).snapshot_key });
      setNote('');
      load();
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
    if (error || (data as any)?.error) {
      toast({ title: 'Restore failed', description: error?.message || (data as any)?.error, variant: 'destructive' });
    } else {
      toast({ title: 'System restored', description: `From ${key}` });
      setRestoreFor(null); setRestoreText(''); load();
    }
  };

  return (
    <div className="space-y-3 pb-8">
      <PageHeader title="System Backups" subtitle="Create snapshots before risky operations, restore on demand" />

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
              {restoreFor === r.snapshot_key ? (
                <div className="space-y-2 border-t pt-2">
                  <p className="text-xs text-destructive">
                    This wipes current documents, audit logs, configs &amp; assignments and replaces them with the snapshot. Files in the documents bucket are overwritten.
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
              ) : (
                <Button size="sm" variant="outline" onClick={() => { setRestoreFor(r.snapshot_key); setRestoreText(''); }}>
                  <RotateCcw className="w-4 h-4 mr-1" />Restore from this snapshot
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
