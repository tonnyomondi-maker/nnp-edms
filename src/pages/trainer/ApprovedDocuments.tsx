// Trainer — final approved documents for a training session.
// Only DP-approved / archived documents appear here; each one can be viewed or
// downloaded as the fully signed copy (with the Google Drive link when mirrored).

import { useMemo, useState } from 'react';
import { useMyDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Eye, FileCheck2 } from 'lucide-react';
import { getCachedSignedUrl } from '@/hooks/useSignedDocUrl';
import { toast } from '@/hooks/use-toast';
import { sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useCurrentSession } from '@/hooks/useAcademicSession';

const ALL = 'ALL';

export default function ApprovedDocuments() {
  const { data: docs, isLoading } = useMyDocuments();
  const { data: adminSession } = useCurrentSession();
  const [session, setSession] = useState<string>(ALL);
  const [busy, setBusy] = useState<string | null>(null);

  const approved = useMemo(
    () => (docs || []).filter((d) => ['DP_APPROVED', 'ARCHIVED', 'EXPORTED'].includes(d.status)),
    [docs],
  );

  const sessions = useMemo(() => {
    const order: Record<string, number> = { JAN_APR: 1, MAY_AUG: 2, SEP_DEC: 3 };
    const map = new Map<string, { key: string; label: string; year: number; term: string; count: number }>();
    for (const d of approved) {
      if (!d.session_year || !d.session_term) continue;
      const key = `${d.session_year}_${d.session_term}`;
      const e = map.get(key) || {
        key, label: sessionLabel(d.session_year, d.session_term as SessionTerm),
        year: d.session_year, term: d.session_term, count: 0,
      };
      e.count += 1;
      map.set(key, e);
    }
    return Array.from(map.values()).sort((a, b) => b.year - a.year || (order[b.term] || 0) - (order[a.term] || 0));
  }, [approved]);

  const defaultKey = adminSession ? `${adminSession.session_year}_${adminSession.session_term}` : ALL;
  const active = session === ALL ? ALL : session;
  const filtered = active === ALL ? approved : approved.filter((d) => `${d.session_year}_${d.session_term}` === active);

  const open = async (doc: { id: string; signed_file_url?: string | null; file_url?: string | null; file_name?: string | null }, download: boolean) => {
    const ref = doc.signed_file_url || doc.file_url;
    if (!ref) {
      toast({ title: 'File unavailable', description: 'No stored copy for this document.', variant: 'destructive' });
      return;
    }
    setBusy(doc.id);
    try {
      const url = await getCachedSignedUrl(ref);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.file_name || `${doc.id}.pdf`;
        a.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      toast({ title: 'Could not open file', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="My Approved Documents" subtitle={`${filtered.length} fully approved document(s)`} />

      <div className="mb-4 flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Training session</Label>
        <Select value={session} onValueChange={setSession}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sessions ({approved.length})</SelectItem>
            {sessions.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label} ({s.count}){s.key === defaultKey ? ' • current' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {byUnit.map(([unit, unitDocs]) => (
        <div key={unit} className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground px-1">{unit} · {unitDocs.length} document(s)</p>
        {unitDocs.map((d) => (

          <Card key={d.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileCheck2 className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{d.document_type}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {d.unit_code}{d.class_code ? ` • ${d.class_code}` : ''}
                  {d.session_year && d.session_term ? ` • ${sessionLabel(d.session_year, d.session_term as SessionTerm)}` : ''}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy === d.id} onClick={() => open(d, false)}>
                    <Eye className="w-3 h-3" /> View
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1" disabled={busy === d.id} onClick={() => open(d, true)}>
                    {busy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Download signed copy
                  </Button>
                  {(d as { gdrive_web_view_link?: string | null }).gdrive_web_view_link && (
                    <a
                      href={(d as { gdrive_web_view_link?: string }).gdrive_web_view_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center px-2 h-7 rounded border text-xs text-emerald-700 dark:text-emerald-300"
                    >
                      Google Drive copy
                    </a>
                  )}
                </div>
              </div>
              <StatusBadge status={d.status} />
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No approved documents yet for this session.
          </p>
        )}
      </div>
    </div>
  );
}
