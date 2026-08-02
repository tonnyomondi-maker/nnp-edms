import { useMemo, useState } from 'react';
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
            <div key={d.id}>
              <DocumentCard doc={d} />
              {d.rejection_reason && (
                <p className="text-xs text-destructive mt-1 ml-1">Reason: {d.rejection_reason}</p>
              )}
              <RejectedResubmitButton docId={d.id} />
            </div>
          ))}
          {rejected.length === 0 && <EmptyState text="No rejected documents" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
