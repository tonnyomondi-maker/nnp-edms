import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMyDocuments } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { RejectedResubmitButton } from '@/components/common/RejectedResubmitButton';
import { sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useCurrentSession } from '@/hooks/useAcademicSession';

const ALL = 'ALL';

export default function MySubmissions() {
  const { data: docs, isLoading } = useMyDocuments();
  const { data: adminSession } = useCurrentSession();
  const [session, setSession] = useState<string>(ALL);

  const allDocs = useMemo(() => docs || [], [docs]);

  // Every session the trainer has ever submitted into, newest first.
  const sessions = useMemo(() => {
    const order: Record<string, number> = { JAN_APR: 1, MAY_AUG: 2, SEP_DEC: 3 };
    const map = new Map<string, { key: string; label: string; year: number; term: string; count: number }>();
    for (const d of allDocs) {
      if (!d.session_year || !d.session_term) continue;
      const key = `${d.session_year}_${d.session_term}`;
      const e = map.get(key) || {
        key,
        label: sessionLabel(d.session_year, d.session_term as SessionTerm),
        year: d.session_year,
        term: d.session_term,
        count: 0,
      };
      e.count += 1;
      map.set(key, e);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.year - a.year || (order[b.term] || 0) - (order[a.term] || 0),
    );
  }, [allDocs]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const filtered = session === ALL
    ? allDocs
    : allDocs.filter((d) => `${d.session_year}_${d.session_term}` === session);

  const isCurrentSession =
    session === ALL ||
    (adminSession && session === `${adminSession.session_year}_${adminSession.session_term}`);

  const pending = filtered.filter(d => ['SUBMITTED', 'HOD_APPROVED', 'DP_APPROVED'].includes(d.status));
  const completed = filtered.filter(d => d.status === 'ARCHIVED');
  const rejected = filtered.filter(d => d.status === 'REJECTED');

  return (
    <div>
      <PageHeader title="My Submissions" subtitle={`${filtered.length} document(s)`} />

      <div className="mb-4 flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Training session</Label>
        <Select value={session} onValueChange={setSession}>
          <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sessions ({allDocs.length})</SelectItem>
            {sessions.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label} ({s.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isCurrentSession && (
        <p className="mb-3 text-[11px] text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
          Viewing a past training session — these documents are read-only history. New uploads always go
          into the session the administrator has opened.
        </p>
      )}

      <Tabs defaultValue="pending">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="pending" className="flex-1">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="rejected" className="flex-1">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-3">
          {pending.length > 0 ? pending.map(d => <DocumentCard key={d.id} doc={d} />) : <EmptyState text="No pending documents" />}
        </TabsContent>
        <TabsContent value="completed" className="space-y-3">
          {completed.length > 0 ? completed.map(d => <DocumentCard key={d.id} doc={d} />) : <EmptyState text="No completed documents" />}
        </TabsContent>
        <TabsContent value="rejected" className="space-y-3">
          {rejected.map(d => (
            <div key={d.id} className="rounded-lg border border-destructive/40 bg-destructive/5 p-2">
              <DocumentCard doc={d} />
              <RejectionDetail doc={d} />
              <RejectedResubmitButton docId={d.id} />
            </div>
          ))}
          {rejected.length === 0 && <EmptyState text="No rejected documents" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RejectionDetail({ doc }: { doc: { rejection_reason: string | null; return_note?: string | null; status: string; hod_approved_at: string | null; iqa_reviewed_at?: string | null; dp_approved_at: string | null; updated_at: string; hod_approved_by: string | null; dp_approved_by: string | null } }) {
  const [who, setWho] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The stage the document was sitting at when it was rejected tells us who acted.
      const stage = doc.dp_approved_at ? { role: 'IQAO', id: null }
        : doc.iqa_reviewed_at ? { role: 'Deputy Principal — Academics', id: null }
        : doc.hod_approved_at ? { role: 'IQAO', id: null }
        : { role: 'Head of Department', id: null };
      const { data } = await supabase
        .from('audit_logs')
        .select('performed_by, created_at, details')
        .eq('document_id', (doc as unknown as { id: string }).id)
        .order('created_at', { ascending: false })
        .limit(20);
      const rejectLog = (data || []).find((l) => (l.details as { new_status?: string } | null)?.new_status === 'REJECTED');
      let name = '';
      if (rejectLog?.performed_by) {
        const { data: prof } = await supabase
          .from('profiles').select('full_name').eq('user_id', rejectLog.performed_by).maybeSingle();
        name = prof?.full_name || '';
      }
      if (!cancelled) setWho({ name: name || 'Approver', role: stage.role });
    })();
    return () => { cancelled = true; };
  }, [doc]);

  return (
    <div className="mt-2 rounded-md border border-destructive/40 bg-background p-3 text-xs space-y-1">
      <p className="font-semibold text-destructive">Rejected by {who?.name || '…'} ({who?.role || '…'})</p>
      <p className="text-muted-foreground">{new Date(doc.updated_at).toLocaleString()}</p>
      <p><span className="font-medium">Reason: </span>{doc.rejection_reason || 'No comment provided'}</p>
      {doc.return_note && <p><span className="font-medium">Return note: </span>{doc.return_note}</p>}
      <p className="text-muted-foreground">Use “Edit &amp; Resubmit” below — this keeps one continuous history for the document.</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
