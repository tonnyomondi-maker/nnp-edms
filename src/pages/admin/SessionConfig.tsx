import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAcademicSessions, useUpsertSession, useSetCurrentSession } from '@/hooks/useAcademicSession';
import { SESSION_TERMS, sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { Loader2, CheckCircle2, Lock, CalendarPlus } from 'lucide-react';

export default function SessionConfig() {
  const guard = useRoleGuard();
  const { data: sessions, isLoading } = useAcademicSessions();
  const upsert = useUpsertSession();
  const setCurrent = useSetCurrentSession();

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<string>(String(thisYear));
  const [term, setTerm] = useState<SessionTerm>('JAN_APR');
  const [status, setStatus] = useState<'PLANNED' | 'OPEN' | 'LOCKED' | 'CLOSED'>('OPEN');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [graceDays, setGraceDays] = useState<number>(0);
  const [bulkYear, setBulkYear] = useState<string>(String(thisYear));
  const [bulkBusy, setBulkBusy] = useState(false);

  const currentSession = useMemo(() => (sessions || []).find((s) => s.is_current), [sessions]);
  const yearNum = Number(year);
  const yearValid = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100;

  if (!guard.isSuperAdmin) {
    return <p className="p-6 text-sm text-muted-foreground">Only Super Admin can configure sessions.</p>;
  }

  const save = async () => {
    if (!yearValid) {
      toast({ title: 'Enter a valid academic year', description: 'Use a 4-digit year such as 2026.', variant: 'destructive' });
      return;
    }
    try {
      await upsert.mutateAsync({
        session_year: yearNum,
        session_term: term,
        status,
        submission_opens_at: opensAt ? new Date(opensAt).toISOString() : null,
        submission_closes_at: closesAt ? new Date(closesAt).toISOString() : null,
        late_grace_days: graceDays,
      });
      toast({ title: 'Session saved', description: sessionLabel(yearNum, term) });
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const createYear = async () => {
    const y = Number(bulkYear);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      toast({ title: 'Enter a valid academic year', variant: 'destructive' });
      return;
    }
    setBulkBusy(true);
    try {
      for (const t of SESSION_TERMS) {
        await upsert.mutateAsync({ session_year: y, session_term: t.key, status: 'PLANNED', late_grace_days: 0 });
      }
      toast({ title: `Created the three ${y} sessions`, description: 'Open the one that is running and mark it current.' });
    } catch (e) {
      toast({ title: 'Could not create sessions', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Training Sessions"
        subtitle="Set the academic year and term, and control when trainers may submit"
      />

      <Card className="mb-4 border-primary/40 bg-primary/5">
        <CardContent className="p-3 text-xs">
          {currentSession ? (
            <>
              <span className="font-semibold">Current session: </span>
              {sessionLabel(currentSession.session_year, currentSession.session_term)} — status {currentSession.status}.
              Trainer uploads are locked to this session.
            </>
          ) : (
            <>No current session set. Trainer uploads fall back to the calendar term — set one below.</>
          )}
        </CardContent>
      </Card>

      {/* Quick create */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Academic year</Label>
            <Input
              className="mt-1 w-32"
              inputMode="numeric"
              value={bulkYear}
              onChange={(e) => setBulkYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="2026"
            />
          </div>
          <Button variant="outline" onClick={createYear} disabled={bulkBusy}>
            {bulkBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarPlus className="w-4 h-4 mr-2" />}
            Create all three sessions for {bulkYear || '—'}
          </Button>
          <p className="text-[11px] text-muted-foreground basis-full">
            Creates January – April, May – August and September – December as planned sessions you can then open.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Create / update a session</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label>Academic year</Label>
              <Input
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="2026"
              />
            </div>
            <div>
              <Label>Training session</Label>
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
                  <SelectItem value="PLANNED">Planned — not yet open</SelectItem>
                  <SelectItem value="OPEN">Open — trainers may submit</SelectItem>
                  <SelectItem value="LOCKED">Locked — temporarily paused</SelectItem>
                  <SelectItem value="CLOSED">Closed — no more submissions</SelectItem>
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
          <p className="text-[11px] text-muted-foreground">
            Saving {yearValid ? sessionLabel(yearNum, term) : 'this session'} updates it if it already exists.
            Leave the dates empty to allow submissions for as long as the status is Open.
          </p>
          <Button onClick={save} disabled={upsert.isPending || !yearValid}>
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
                <p className="text-sm font-semibold">{sessionLabel(s.session_year, s.session_term)}</p>
                <p className="text-xs text-muted-foreground">
                  {s.submission_opens_at ? new Date(s.submission_opens_at).toLocaleDateString() : 'no start date'}
                  {' → '}
                  {s.submission_closes_at ? new Date(s.submission_closes_at).toLocaleDateString() : 'no end date'}
                  {s.late_grace_days > 0 && ` (+${s.late_grace_days}d grace)`}
                </p>
              </div>
              <Badge variant={s.status === 'OPEN' ? 'default' : 'secondary'}>{s.status}</Badge>
              {s.is_current ? (
                <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Current</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCurrent.mutate(s.id)}>Make current</Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setYear(String(s.session_year));
                  setTerm(s.session_term);
                  setStatus(s.status);
                  setGraceDays(s.late_grace_days || 0);
                  setOpensAt(s.submission_opens_at ? s.submission_opens_at.slice(0, 16) : '');
                  setClosesAt(s.submission_closes_at ? s.submission_closes_at.slice(0, 16) : '');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Edit
              </Button>
              {s.status === 'LOCKED' && <Lock className="w-4 h-4 text-amber-500" />}
            </CardContent>
          </Card>
        ))}
        {sessions?.length === 0 && <p className="text-xs text-muted-foreground">No sessions configured yet.</p>}
      </div>
    </div>
  );
}
