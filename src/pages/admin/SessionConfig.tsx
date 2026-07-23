import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAcademicSessions, useUpsertSession, useSetCurrentSession } from '@/hooks/useAcademicSession';
import { SESSION_TERMS, type SessionTerm } from '@/lib/sessions';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { Loader2, CheckCircle2, Lock } from 'lucide-react';

export default function SessionConfig() {
  const guard = useRoleGuard();
  const { data: sessions, isLoading } = useAcademicSessions();
  const upsert = useUpsertSession();
  const setCurrent = useSetCurrentSession();

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [term, setTerm] = useState<SessionTerm>('JAN_APR');
  const [status, setStatus] = useState<'PLANNED' | 'OPEN' | 'LOCKED' | 'CLOSED'>('OPEN');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [graceDays, setGraceDays] = useState<number>(0);

  if (!guard.isSuperAdmin) {
    return <p className="p-6 text-sm text-muted-foreground">Only Super Admin can configure sessions.</p>;
  }

  const save = async () => {
    try {
      await upsert.mutateAsync({
        session_year: year,
        session_term: term,
        status,
        submission_opens_at: opensAt ? new Date(opensAt).toISOString() : null,
        submission_closes_at: closesAt ? new Date(closesAt).toISOString() : null,
        late_grace_days: graceDays,
      });
      toast({ title: 'Session saved' });
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  return (
    <div>
      <PageHeader title="Academic Sessions" subtitle="Control when trainers may submit documents" />
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Create / update session</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label>Year</Label>
              <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <div>
              <Label>Term</Label>
              <Select value={term} onValueChange={(v) => setTerm(v as SessionTerm)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SESSION_TERMS.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="LOCKED">Locked</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Opens at</Label>
              <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            </div>
            <div>
              <Label>Closes at</Label>
              <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </div>
            <div>
              <Label>Grace days</Label>
              <Input type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save session
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 space-y-2">
        <p className="text-sm font-semibold">Existing sessions</p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
        {sessions?.map(s => (
          <Card key={s.id}>
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{s.session_term} {s.session_year}</p>
                <p className="text-xs text-muted-foreground">
                  {s.submission_opens_at ? new Date(s.submission_opens_at).toLocaleDateString() : '—'}
                  {' → '}
                  {s.submission_closes_at ? new Date(s.submission_closes_at).toLocaleDateString() : '—'}
                  {s.late_grace_days > 0 && ` (+${s.late_grace_days}d grace)`}
                </p>
              </div>
              <Badge variant={s.status === 'OPEN' ? 'default' : 'secondary'}>{s.status}</Badge>
              {s.is_current ? (
                <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Current</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCurrent.mutate(s.id)}>Make current</Button>
              )}
              {s.status === 'LOCKED' && <Lock className="w-4 h-4 text-amber-500" />}
            </CardContent>
          </Card>
        ))}
        {sessions?.length === 0 && <p className="text-xs text-muted-foreground">No sessions configured yet.</p>}
      </div>
    </div>
  );
}
