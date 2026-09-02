// Super Admin maintenance: find and remove "ghost" document records whose file
// never reached Google Drive (or legacy Storage). These rows sit in approver
// queues and fail at stamping time, so clearing them lets trainers re-submit.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FileWarning, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface OrphanRow {
  id: string;
  file_name: string | null;
  document_type: string;
  department: string | null;
  status: string;
  created_at: string;
}

export function OrphanDocumentsCard() {
  const [rows, setRows] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('id, file_name, document_type, department, status, created_at')
      .is('gdrive_file_id', null)
      .is('file_url', null)
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Could not load records', description: error.message, variant: 'destructive' });
    }
    setRows(((data as unknown as OrphanRow[]) || []));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const purge = async () => {
    if (!rows.length) return;
    if (!confirm(`Remove ${rows.length} document record(s) with no attached file? Trainers will be able to upload them again.`)) return;
    setBusy(true);
    const { error } = await supabase.from('documents').delete().in('id', rows.map((r) => r.id));
    setBusy(false);
    if (error) {
      toast({ title: 'Cleanup failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Cleanup complete', description: `${rows.length} empty record(s) removed.` });
    load();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileWarning className="w-4 h-4 text-amber-600" /> Documents with no attached file
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          These submissions have no file in Google Drive or storage, so they can never be verified,
          reviewed or approved. Removing them lets the trainer upload the document again.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No empty records found.</p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="text-xs flex flex-wrap justify-between gap-2 rounded border border-border px-2 py-1">
                <span className="font-medium truncate">{r.document_type}{r.file_name ? ` — ${r.file_name}` : ''}</span>
                <span className="text-muted-foreground">{r.department || '—'} · {r.status} · {new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading || busy} className="gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" variant="destructive" onClick={purge} disabled={busy || rows.length === 0} className="gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove {rows.length || ''} empty record(s)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
