import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentSession } from '@/hooks/useAcademicSession';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Lock, Eye, Upload, Users, Loader2, Send, CloudUpload } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
type Paper = any;

const TYPES: Record<string, string> = { MAIN: 'Main exam', SUPPLEMENTARY: 'Supplementary / Special', CAT1: 'CAT 1', CAT2: 'CAT 2' };
const STAGE: Record<string, string> = {
  SUBMITTED: 'With committee', COMMITTEE_ENDORSED: 'With HOD', HOD_ENDORSED: 'With IQAO',
  IQA_CLEARED: 'Cleared for printing', RECEIVED: 'Received by Exams Office', RETURNED: 'Returned for correction',
};
const RUBRIC = ['Covers the syllabus / curriculum outcomes', 'Questions are clear and unambiguous', 'Marks allocation is correct and totals tally',
  'Marking scheme is complete and matches questions', 'Appropriate level of difficulty (Bloom’s spread)', 'Instructions, time and format are correct'];

async function fnError(error: unknown) {
  if (error instanceof FunctionsHttpError) { try { return (await error.context.json()).error; } catch { /* */ } }
  return (error as Error)?.message || 'Something went wrong';
}

async function openWatermarked(paperId: string, which: 'paper' | 'scheme') {
  const { data, error } = await supabase.functions.invoke('exam-vault', { body: { action: 'view', paperId, which } });
  if (error) return toast.error(await fnError(error));
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

function usePapers() {
  return useQuery({
    queryKey: ['exam_papers'],
    queryFn: async () => {
      const { data, error } = await db.from('exam_papers').select('*').order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Paper[];
    },
  });
}

function StageBadge({ s }: { s: string }) {
  const v = s === 'RETURNED' ? 'destructive' : s === 'IQA_CLEARED' || s === 'RECEIVED' ? 'default' : 'secondary';
  return <Badge variant={v as any}>{STAGE[s] || s}</Badge>;
}

function PaperRow({ p, onOpen, extra }: { p: Paper; onOpen?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium">{p.unit_code} {p.unit_name ? `· ${p.unit_name}` : ''}</div>
        <div className="text-xs text-muted-foreground">{TYPES[p.paper_type]} · {p.department}{p.section ? ` / ${p.section}` : ''} · v{p.version} · {p.session_year} {p.session_term}</div>
        {p.status === 'RETURNED' && p.return_reason && <div className="text-xs text-destructive mt-1">Returned by {p.returned_stage}: {p.return_reason}</div>}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <StageBadge s={p.status} />
        <Button size="sm" variant="outline" onClick={() => openWatermarked(p.id, 'paper')}><Eye className="w-4 h-4 mr-1" />Paper</Button>
        <Button size="sm" variant="outline" onClick={() => openWatermarked(p.id, 'scheme')}><Eye className="w-4 h-4 mr-1" />Scheme</Button>
        {onOpen && <Button size="sm" onClick={onOpen}>Open</Button>}
        {extra}
      </div>
    </div>
  );
}

/* ---------------- Trainer ---------------- */
function TrainerTab({ papers }: { papers: Paper[] }) {
  const { currentUser } = useAuth();
  const { data: session } = useCurrentSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ unit_code: '', unit_name: '', class_code: '', paper_type: 'MAIN', section: '' });
  const [paper, setPaper] = useState<File | null>(null);
  const [scheme, setScheme] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: sections = [] } = useQuery({
    queryKey: ['exam_sections', currentUser?.department],
    queryFn: async () => {
      const { data } = await db.from('exam_committees').select('section').eq('department', currentUser?.department).eq('active', true);
      return Array.from(new Set((data || []).map((c: any) => c.section).filter(Boolean))) as string[];
    },
    enabled: !!currentUser?.department,
  });
  const mine = papers.filter((p) => p.trainer_id === currentUser?.id);

  const submit = async (resubmitId?: string, files?: { paper: File | null; scheme: File | null }) => {
    const fd = new FormData();
    if (resubmitId) {
      fd.append('paperId', resubmitId);
      if (files?.paper) fd.append('paper', files.paper);
      if (files?.scheme) fd.append('scheme', files.scheme);
    } else {
      if (!session) return toast.error('No current academic session is set');
      if (!paper || !scheme || !f.unit_code.trim()) return toast.error('Unit code, paper and marking scheme are required');
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      fd.append('session_year', String(session.session_year)); fd.append('session_term', session.session_term);
      fd.append('paper', paper); fd.append('scheme', scheme);
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('exam-vault', { body: fd });
    setBusy(false);
    if (error) return toast.error(await fnError(error));
    toast.success(resubmitId ? 'Corrected paper resubmitted to the committee' : data?.committee_assigned ? 'Submitted — your moderation committee has been notified' : 'Submitted — your HOD will assign a committee');
    setPaper(null); setScheme(null); setF({ ...f, unit_code: '', unit_name: '', class_code: '' });
    qc.invalidateQueries({ queryKey: ['exam_papers'] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />Submit an assessment for validation</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Unit code *" value={f.unit_code} onChange={(e) => setF({ ...f, unit_code: e.target.value })} />
          <Input placeholder="Unit name" value={f.unit_name} onChange={(e) => setF({ ...f, unit_name: e.target.value })} />
          <Input placeholder="Class code" value={f.class_code} onChange={(e) => setF({ ...f, class_code: e.target.value })} />
          <Select value={f.paper_type} onValueChange={(v) => setF({ ...f, paper_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          {sections.length > 0 && (
            <Select value={f.section || 'none'} onValueChange={(v) => setF({ ...f, section: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Whole department</SelectItem>
                {sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="text-sm">Question paper (PDF) *<Input type="file" accept="application/pdf" onChange={(e) => setPaper(e.target.files?.[0] || null)} /></label>
          <label className="text-sm">Marking scheme (PDF) *<Input type="file" accept="application/pdf" onChange={(e) => setScheme(e.target.files?.[0] || null)} /></label>
          <div className="sm:col-span-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" />Stored in the sealed exams vault — never in the normal document flow.</p>
            <Button disabled={busy} onClick={() => submit()}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit</Button>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">My assessment papers</h3>
        {mine.length === 0 && <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>}
        {mine.map((p) => <PaperRow key={p.id} p={p} extra={p.status === 'RETURNED' && <ResubmitButton onSubmit={(files) => submit(p.id, files)} />} />)}
      </div>
    </div>
  );
}

function ResubmitButton({ onSubmit }: { onSubmit: (f: { paper: File | null; scheme: File | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState<File | null>(null);
  const [scheme, setScheme] = useState<File | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Resubmit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resubmit corrected paper</DialogTitle></DialogHeader>
          <label className="text-sm">Corrected paper (PDF) *<Input type="file" accept="application/pdf" onChange={(e) => setPaper(e.target.files?.[0] || null)} /></label>
          <label className="text-sm">Updated marking scheme (optional)<Input type="file" accept="application/pdf" onChange={(e) => setScheme(e.target.files?.[0] || null)} /></label>
          <Button disabled={!paper} onClick={() => { onSubmit({ paper, scheme }); setOpen(false); }}>Resubmit to committee</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- Shared committee workspace ---------------- */
function Workspace({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const [rubric, setRubric] = useState<Record<string, boolean>>(paper.rubric || {});
  const [minutes, setMinutes] = useState(paper.committee_minutes || '');
  const [note, setNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const { data: notes = [], refetch } = useQuery({
    queryKey: ['exam_notes', paper.id],
    queryFn: async () => (await db.from('exam_paper_notes').select('*').eq('paper_id', paper.id).order('created_at')).data || [],
  });
  const { data: signoffs = [] } = useQuery({
    queryKey: ['exam_signoffs', paper.id, paper.version],
    queryFn: async () => (await db.from('exam_paper_signoffs').select('*').eq('paper_id', paper.id).eq('version', paper.version)).data || [],
  });
  const { data: members = [] } = useQuery({
    queryKey: ['exam_members', paper.committee_id],
    queryFn: async () => {
      const { data } = await db.from('exam_committee_members').select('user_id').eq('committee_id', paper.committee_id);
      const ids = (data || []).map((m: any) => m.user_id);
      const { data: pr } = await supabase.from('profiles').select('user_id,full_name').in('user_id', ids);
      return pr || [];
    },
    enabled: !!paper.committee_id,
  });
  useEffect(() => {
    const ch = supabase.channel(`exam-notes-${paper.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_paper_notes', filter: `paper_id=eq.${paper.id}` }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [paper.id, refetch]);

  const editable = paper.status === 'SUBMITTED' && paper.trainer_id !== currentUser?.id;
  const rpc = async (fn: string, args: any, ok: string) => {
    const { error } = await db.rpc(fn, args);
    if (error) return toast.error(error.message);
    toast.success(ok); qc.invalidateQueries({ queryKey: ['exam_papers'] }); qc.invalidateQueries({ queryKey: ['exam_signoffs'] });
    return true;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Moderation workspace · {paper.unit_code} ({TYPES[paper.paper_type]})</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openWatermarked(paper.id, 'paper')}><Eye className="w-4 h-4 mr-1" />Question paper</Button>
          <Button size="sm" variant="outline" onClick={() => openWatermarked(paper.id, 'scheme')}><Eye className="w-4 h-4 mr-1" />Marking scheme</Button>
        </div>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Moderation checklist (shared)</h4>
          {RUBRIC.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <Checkbox disabled={!editable} checked={!!rubric[r]} onCheckedChange={(v) => setRubric({ ...rubric, [r]: !!v })} />{r}
            </label>
          ))}
          <Textarea disabled={!editable} placeholder="Committee meeting minutes / moderation report" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          {editable && <Button size="sm" variant="secondary" onClick={() => rpc('exam_save_rubric', { _paper_id: paper.id, _rubric: rubric, _minutes: minutes }, 'Moderation sheet saved')}>Save sheet</Button>}
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Sign-offs ({signoffs.filter((s: any) => s.decision === 'APPROVE').length}/{members.filter((m: any) => m.user_id !== paper.trainer_id).length})</h4>
          <div className="flex flex-wrap gap-1">
            {members.map((m: any) => {
              const s = signoffs.find((x: any) => x.member_id === m.user_id);
              return <Badge key={m.user_id} variant={s?.decision === 'APPROVE' ? 'default' : 'outline'}>{m.full_name}{s ? ` · ${s.decision === 'APPROVE' ? 'approved' : 'returned'}` : ''}</Badge>;
            })}
          </div>
          {editable && (
            <div className="flex flex-col gap-2">
              <Input placeholder="Reason (required to return)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => rpc('exam_committee_signoff', { _paper_id: paper.id, _decision: 'APPROVE', _note: decisionNote || null }, 'Your approval is recorded')}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={async () => (await rpc('exam_committee_signoff', { _paper_id: paper.id, _decision: 'RETURN', _note: decisionNote }, 'Returned to trainer')) && onClose()}>Return to trainer</Button>
              </div>
            </div>
          )}
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Discussion</h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {notes.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
            {notes.map((n: any) => <div key={n.id} className="text-sm border-l-2 border-primary pl-2"><span className="font-medium">{n.author_name}</span> <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span><div>{n.body}</div></div>)}
          </div>
          <div className="flex gap-2">
            <Input placeholder="Add a comment for the committee" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="icon" onClick={async () => { if (await rpc('exam_add_note', { _paper_id: paper.id, _body: note }, 'Comment added')) { setNote(''); refetch(); } }}><Send className="w-4 h-4" /></Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function CommitteeTab({ papers }: { papers: Paper[] }) {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState<Paper | null>(null);
  const { data: myCommittees = [] } = useQuery({
    queryKey: ['my_committees', currentUser?.id],
    queryFn: async () => ((await db.from('exam_committee_members').select('committee_id').eq('user_id', currentUser?.id)).data || []).map((r: any) => r.committee_id),
  });
  const list = papers.filter((p) => myCommittees.includes(p.committee_id) && p.trainer_id !== currentUser?.id);
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-sm text-muted-foreground">No papers assigned to your committees.</p>}
      {list.map((p) => <PaperRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}
      {open && <Workspace paper={papers.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------- HOD ---------------- */
function CommitteesManager() {
  const { currentUser } = useAuth();
  const { data: session } = useCurrentSession();
  const qc = useQueryClient();
  const [name, setName] = useState(''); const [section, setSection] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { data: staff = [] } = useQuery({
    queryKey: ['dept_staff', currentUser?.department],
    queryFn: async () => (await supabase.from('profiles').select('user_id,full_name').eq('department', currentUser!.department!).order('full_name')).data || [],
    enabled: !!currentUser?.department,
  });
  const { data: committees = [] } = useQuery({
    queryKey: ['exam_committees', currentUser?.department],
    queryFn: async () => (await db.from('exam_committees').select('*, exam_committee_members(user_id)').eq('department', currentUser?.department).order('created_at')).data || [],
    enabled: !!currentUser?.department,
  });
  const nameOf = (id: string) => staff.find((s: any) => s.user_id === id)?.full_name || 'Member';
  const create = async () => {
    if (!session) return toast.error('No current session');
    if (!name.trim() || picked.length < 2) return toast.error('Give a name and pick at least 2 members');
    const { data: c, error } = await db.from('exam_committees').insert({ department: currentUser!.department, section: section.trim() || null, name: name.trim(), session_year: session.session_year, session_term: session.session_term, created_by: currentUser!.id }).select().single();
    if (error) return toast.error(error.message);
    const { error: e2 } = await db.from('exam_committee_members').insert(picked.map((u) => ({ committee_id: c.id, user_id: u })));
    if (e2) return toast.error(e2.message);
    toast.success('Committee created'); setName(''); setSection(''); setPicked([]);
    qc.invalidateQueries({ queryKey: ['exam_committees'] });
  };
  const toggleActive = async (c: any) => { await db.from('exam_committees').update({ active: !c.active }).eq('id', c.id); qc.invalidateQueries({ queryKey: ['exam_committees'] }); };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />New moderation committee</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Committee name (e.g. Social Work panel)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Section (leave blank for whole department)" value={section} onChange={(e) => setSection(e.target.value)} />
          </div>
          <div className="grid gap-1 sm:grid-cols-2 max-h-56 overflow-y-auto border rounded p-2">
            {staff.map((s: any) => (
              <label key={s.user_id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(s.user_id)} onCheckedChange={(v) => setPicked(v ? [...picked, s.user_id] : picked.filter((x) => x !== s.user_id))} />{s.full_name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Papers go to the committee of their section first; otherwise to the whole-department committee. You can override per paper.</p>
          <Button onClick={create}>Create committee</Button>
        </CardContent>
      </Card>
      {committees.map((c: any) => (
        <div key={c.id} className="border rounded-lg p-3">
          <div className="flex items-center justify-between gap-2">
            <div><span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">{c.section || 'Whole department'} · {c.session_year} {c.session_term}</span></div>
            <Button size="sm" variant="outline" onClick={() => toggleActive(c)}>{c.active ? 'Deactivate' : 'Activate'}</Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">{c.exam_committee_members.map((m: any) => <Badge key={m.user_id} variant="secondary">{nameOf(m.user_id)}</Badge>)}</div>
        </div>
      ))}
    </div>
  );
}

function StageActions({ p, stage }: { p: Paper; stage: 'HOD' | 'IQA' }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const act = async (action: string) => {
    const { error } = await db.rpc('exam_transition', { _paper_id: p.id, _action: action, _note: note || null });
    if (error) return toast.error(error.message);
    if (stage === 'IQA' && action === 'APPROVE') {
      const { error: e } = await supabase.functions.invoke('exam-vault', { body: { action: 'sync_drive', paperId: p.id } });
      e ? toast.error(`Cleared, but Drive copy failed: ${await fnError(e)}`) : toast.success('Cleared and copied to the Exams Drive folder');
    } else toast.success(action === 'APPROVE' ? 'Endorsed' : 'Returned to trainer');
    qc.invalidateQueries({ queryKey: ['exam_papers'] });
  };
  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
      <Input className="h-8" placeholder="Note / reason" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" onClick={() => act('APPROVE')}>{stage === 'HOD' ? 'Endorse' : 'Clear for printing'}</Button>
      <Button size="sm" variant="destructive" onClick={() => act('RETURN')}>Return</Button>
    </div>
  );
}

function HodTab({ papers }: { papers: Paper[] }) {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Paper | null>(null);
  const dept = papers.filter((p) => p.department === currentUser?.department);
  const { data: committees = [] } = useQuery({
    queryKey: ['exam_committees', currentUser?.department],
    queryFn: async () => (await db.from('exam_committees').select('*, exam_committee_members(user_id)').eq('department', currentUser?.department)).data || [],
  });
  const assign = async (pid: string, cid: string) => {
    const { error } = await db.rpc('exam_assign_committee', { _paper_id: pid, _committee_id: cid });
    error ? toast.error(error.message) : toast.success('Committee assigned and notified');
    qc.invalidateQueries({ queryKey: ['exam_papers'] });
  };
  return (
    <Tabs defaultValue="endorse">
      <TabsList className="flex-wrap h-auto"><TabsTrigger value="endorse">To endorse</TabsTrigger><TabsTrigger value="moderation">In moderation</TabsTrigger><TabsTrigger value="committees">Committees</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList>
      <TabsContent value="endorse" className="space-y-2">
        {dept.filter((p) => p.status === 'COMMITTEE_ENDORSED').map((p) => <PaperRow key={p.id} p={p} onOpen={() => setOpen(p)} extra={<StageActions p={p} stage="HOD" />} />)}
        {!dept.some((p) => p.status === 'COMMITTEE_ENDORSED') && <p className="text-sm text-muted-foreground">Nothing waiting for endorsement.</p>}
      </TabsContent>
      <TabsContent value="moderation" className="space-y-2">
        {dept.filter((p) => p.status === 'SUBMITTED').map((p) => (
          <PaperRow key={p.id} p={p} onOpen={() => setOpen(p)} extra={
            <Select value={p.committee_id || ''} onValueChange={(v) => assign(p.id, v)}>
              <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Assign committee" /></SelectTrigger>
              <SelectContent>{committees.filter((c: any) => c.active).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>} />
        ))}
      </TabsContent>
      <TabsContent value="committees"><CommitteesManager /></TabsContent>
      <TabsContent value="all" className="space-y-2">{dept.map((p) => <PaperRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}</TabsContent>
      {open && <Workspace paper={open} onClose={() => setOpen(null)} />}
    </Tabs>
  );
}

function IqaTab({ papers }: { papers: Paper[] }) {
  const [open, setOpen] = useState<Paper | null>(null);
  const qc = useQueryClient();
  const pending = papers.filter((p) => p.status === 'HOD_ENDORSED');
  const cleared = papers.filter((p) => ['IQA_CLEARED', 'RECEIVED'].includes(p.status));
  const retry = async (id: string) => {
    const { error } = await supabase.functions.invoke('exam-vault', { body: { action: 'sync_drive', paperId: id } });
    error ? toast.error(await fnError(error)) : toast.success('Copied to Drive');
    qc.invalidateQueries({ queryKey: ['exam_papers'] });
  };
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Awaiting IQAO clearance ({pending.length})</h3>
      {pending.map((p) => <PaperRow key={p.id} p={p} onOpen={() => setOpen(p)} extra={<StageActions p={p} stage="IQA" />} />)}
      <h3 className="font-semibold text-sm">Cleared</h3>
      {cleared.map((p) => <PaperRow key={p.id} p={p} extra={<DriveBadge p={p} onRetry={() => retry(p.id)} />} />)}
      {open && <Workspace paper={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DriveBadge({ p, onRetry }: { p: Paper; onRetry: () => void }) {
  if (p.gdrive_status === 'SYNCED') return <Badge variant="outline"><CloudUpload className="w-3 h-3 mr-1" />On Drive</Badge>;
  return <Button size="sm" variant="outline" title={p.gdrive_error || ''} onClick={onRetry}><CloudUpload className="w-4 h-4 mr-1" />{p.gdrive_status === 'FAILED' ? 'Retry Drive' : 'Copy to Drive'}</Button>;
}

function ExamsOfficeTab({ papers }: { papers: Paper[] }) {
  const qc = useQueryClient();
  const receive = async (id: string) => {
    const { error } = await db.rpc('exam_transition', { _paper_id: id, _action: 'RECEIVE', _note: null });
    error ? toast.error(error.message) : toast.success('Marked as received for printing');
    qc.invalidateQueries({ queryKey: ['exam_papers'] });
  };
  return (
    <div className="space-y-2">
      {papers.length === 0 && <p className="text-sm text-muted-foreground">No cleared papers yet.</p>}
      {papers.map((p) => <PaperRow key={p.id} p={p} extra={p.status === 'IQA_CLEARED' && <Button size="sm" onClick={() => receive(p.id)}>Mark received</Button>} />)}
    </div>
  );
}

export default function ExamVault() {
  const { currentUser } = useAuth();
  const { data: papers = [], isLoading } = usePapers();
  const roles = currentUser?.roles || [];
  const { data: isMember } = useQuery({
    queryKey: ['is_committee_member', currentUser?.id],
    queryFn: async () => ((await db.from('exam_committee_members').select('id').eq('user_id', currentUser?.id).limit(1)).data || []).length > 0,
  });
  const tabs = useMemo(() => {
    const t: { key: string; label: string; el: React.ReactNode }[] = [];
    if (roles.includes('TRAINER') || roles.includes('HOD')) t.push({ key: 'mine', label: 'My papers', el: <TrainerTab papers={papers} /> });
    if (isMember) t.push({ key: 'committee', label: 'Committee workspace', el: <CommitteeTab papers={papers} /> });
    if (roles.includes('HOD')) t.push({ key: 'hod', label: 'HOD', el: <HodTab papers={papers} /> });
    if (roles.includes('IQA')) t.push({ key: 'iqa', label: 'IQAO clearance', el: <IqaTab papers={papers} /> });
    if (roles.includes('EXAMS_OFFICE')) t.push({ key: 'exams', label: 'Exams Office', el: <ExamsOfficeTab papers={papers.filter((p) => ['IQA_CLEARED', 'RECEIVED'].includes(p.status))} /> });
    return t;
  }, [roles, papers, isMember]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-primary" />Assessment Validation Vault</h1>
        <p className="text-sm text-muted-foreground">Trainer → Moderation committee → HOD → IQAO → Exams Office. Every view is watermarked with your name and logged.</p>
      </div>
      {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : tabs.length === 0 ? <p className="text-sm text-muted-foreground">You have no role in the assessment workflow.</p> : (
        <Tabs defaultValue={tabs[tabs.length - 1].key}>
          <TabsList className="flex-wrap h-auto">{tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}</TabsList>
          {tabs.map((t) => <TabsContent key={t.key} value={t.key}>{t.el}</TabsContent>)}
        </Tabs>
      )}
    </div>
  );
}
