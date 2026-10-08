import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Search, AlertTriangle, ChevronDown, ChevronUp, Download, Copy, Settings2 } from 'lucide-react';
import { ONE_TIME_DOC_TYPES, PER_UNIT_ONE_TIME_DOC_TYPES } from '@/lib/sessions';
import { toast } from '@/hooks/use-toast';
import { UnitAllocationsManager } from '@/components/common/UnitAllocationsManager';
import { DocumentCard } from '@/components/common/DocumentCard';

type Stage = 'ALL' | 'SUBMITTED' | 'HOD_APPROVED' | 'IQA_REVIEWED' | 'DP_APPROVED' | 'ARCHIVED' | 'REJECTED';

const STAGES: { key: Exclude<Stage, 'ALL'>; label: string; tone: 'muted' | 'primary' | 'destructive' | 'warning' }[] = [
  { key: 'SUBMITTED', label: 'With HOD', tone: 'warning' },
  { key: 'HOD_APPROVED', label: 'With IQAO', tone: 'muted' },
  { key: 'IQA_REVIEWED', label: 'With DP', tone: 'muted' },
  { key: 'DP_APPROVED', label: 'To archive', tone: 'primary' },
  { key: 'ARCHIVED', label: 'Archived', tone: 'primary' },
  { key: 'REJECTED', label: 'Rejected', tone: 'destructive' },
];

export default function HodDashboard() {
  const { currentUser } = useAuth();
  const dept = currentUser?.department || '';
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<Stage>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [showUnits, setShowUnits] = useState(false);

  const missingFor = (trainerId: string) => {
    if (!data) return [] as { unit: string; name: string; missing: string[] }[];
    const docs = data.docs.filter((d) => d.trainer_id === trainerId && d.status !== 'REJECTED');
    const seen = new Set<string>();
    return data.configs.filter((c) => c.trainer_id === trainerId && !seen.has(c.unit_code) && seen.add(c.unit_code))
      .map((c) => ({
        unit: c.unit_code, name: c.unit_name || '',
        missing: (PER_UNIT_ONE_TIME_DOC_TYPES as readonly string[]).filter((t) => !docs.some((d) => d.unit_code === c.unit_code && d.document_type === t)),
      }))
      .filter((u) => u.missing.length > 0);
  };

  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['The Nyamira National Polytechnic — Missing Documents', dept, new Date().toLocaleString()].map(esc).join(','),
      ['Trainer', 'Email', 'PF Number', 'Unit code', 'Unit name', 'Missing documents', 'Count'].map(esc).join(',')];
    rows.forEach((r) => missingFor(r.user_id).forEach((u) =>
      lines.push([r.full_name, r.email, r.pf_number || '', u.unit, u.name, u.missing.join('; '), String(u.missing.length)].map(esc).join(','))));
    if (lines.length === 2) { toast({ title: 'Nothing missing', description: 'All registered units have their one-time documents.' }); return; }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `missing-documents-${dept.replace(/\W+/g, '-')}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const copyReminder = async (r: { user_id: string; full_name: string }) => {
    const m = missingFor(r.user_id);
    const body = m.length ? m.map((u) => `• ${u.unit}${u.name ? ` (${u.name})` : ''}: ${u.missing.join(', ')}`).join('\n') : '• Please check your pending documents on the portal.';
    const text = `Dear ${r.full_name || 'Trainer'},\n\nThis is a reminder from the ${dept} HOD office. The following documents are still outstanding on the EDMS portal:\n${body}\n\nKindly upload them at your earliest convenience.\n\nThank you.\nThe Nyamira National Polytechnic`;
    try { await navigator.clipboard.writeText(text); toast({ title: 'Reminder copied', description: 'Paste it into WhatsApp, SMS or email.' }); }
    catch { toast({ title: 'Could not copy', variant: 'destructive' }); }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['hod-dashboard', dept],
    enabled: !!dept,
    queryFn: async () => {
      const [trainersRes, docsRes, configsRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name, email, pf_number, department').eq('department', dept),
        supabase.from('documents').select('*').eq('department', dept),
        supabase.from('unit_session_config' as never).select('*').eq('department', dept),
      ]);
      return {
        trainers: trainersRes.data || [],
        docs: docsRes.data || [],
        configs: (configsRes.data || []) as unknown as Array<{ trainer_id: string; unit_code: string; unit_name: string | null }>,
      };
    },
  });

  const deptTotals = useMemo(() => {
    const t: Record<string, number> = {};
    (data?.docs || []).forEach((d) => { t[d.status] = (t[d.status] || 0) + 1; });
    return t;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    // Include trainers who submitted into this department but belong elsewhere.
    const ids = new Set(data.trainers.map((t) => t.user_id));
    const extra = Array.from(new Set(data.docs.map((d) => d.trainer_id).filter((id) => !ids.has(id))))
      .map((id) => ({ user_id: id, full_name: 'Trainer from another department', email: '', pf_number: null, department: null }));
    return [...data.trainers, ...extra]
      .filter((t) => !search || t.full_name?.toLowerCase().includes(search.toLowerCase()) || t.email?.toLowerCase().includes(search.toLowerCase()))
      .map((t) => {
        const tDocs = data.docs.filter((d) => d.trainer_id === t.user_id);
        const byStage: Record<string, number> = {};
        tDocs.forEach((d) => { byStage[d.status] = (byStage[d.status] || 0) + 1; });
        const tConfigs = data.configs.filter((c) => c.trainer_id === t.user_id);
        const unitCount = new Set(tConfigs.map((c) => c.unit_code)).size;
        const expectedOneTime = unitCount * ONE_TIME_DOC_TYPES.length;
        const oneTimeSubmitted = tDocs.filter((d) => d.status !== 'REJECTED' && (ONE_TIME_DOC_TYPES as readonly string[]).includes(d.document_type)).length;
        const missingOneTime = Math.max(0, expectedOneTime - oneTimeSubmitted);
        const shown = stage === 'ALL' ? tDocs : tDocs.filter((d) => d.status === stage);
        const inFlight = (byStage.SUBMITTED || 0) + (byStage.HOD_APPROVED || 0) + (byStage.IQA_REVIEWED || 0) + (byStage.REJECTED || 0);
        const needsAttention = inFlight > 0 || missingOneTime > 0 || (unitCount > 0 && tDocs.length === 0);
        return { ...t, tDocs: shown, total: tDocs.length, byStage, unitCount, missingOneTime, expectedOneTime, needsAttention };
      })
      .filter((r) => stage === 'ALL' || r.tDocs.length > 0)
      .filter((r) => !attentionOnly || r.needsAttention)
      .sort((a, b) => (b.byStage.SUBMITTED || 0) - (a.byStage.SUBMITTED || 0));
  }, [data, search, stage, attentionOnly]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Trainer Progress" subtitle={`${dept} • ${rows.length} trainer(s) • ${data?.docs.length || 0} document(s)`} />

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {STAGES.map((s) => (
          <button key={s.key} type="button" onClick={() => setStage(stage === s.key ? 'ALL' : s.key)}
            className={`rounded border p-2 text-center transition-colors ${stage === s.key ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'}`}>
            <p className="text-base font-bold">{deptTotals[s.key] || 0}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </button>
        ))}
      </div>
      {stage !== 'ALL' && (
        <p className="text-[11px] text-muted-foreground">Showing only “{STAGES.find((s) => s.key === stage)?.label}”. Tap it again to clear.</p>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trainer…" className="pl-9" />
        </div>
        <Button variant={attentionOnly ? 'default' : 'outline'} className="text-xs" onClick={() => setAttentionOnly((v) => !v)}>
          {attentionOnly ? 'Needs attention ✓' : 'Needs attention'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="text-xs" onClick={exportCsv}><Download className="w-3 h-3 mr-1" />Missing documents CSV</Button>
        <Button variant={showUnits ? 'default' : 'outline'} size="sm" className="text-xs" onClick={() => setShowUnits((v) => !v)}><Settings2 className="w-3 h-3 mr-1" />Manage registered units</Button>
      </div>
      {showUnits && <Card><CardContent className="p-3"><UnitAllocationsManager department={dept} /></CardContent></Card>}
      {rows.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No trainers or documents match.
        </CardContent></Card>
      ) : rows.map((r) => (
        <Card key={r.user_id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{r.full_name}{r.user_id === currentUser?.id ? ' (you)' : ''}</p>
                <p className="text-[11px] text-muted-foreground">{r.email}{r.pf_number ? ` • ${r.pf_number}` : ''}</p>
              </div>
              <div className="flex gap-1">
                {r.unitCount > 0 && r.total === 0 && <Badge variant="destructive" className="text-[10px]">No submissions</Badge>}
                <Badge variant="secondary" className="text-[10px]">{r.unitCount} unit(s)</Badge>
                <Badge variant="outline" className="text-[10px]">{r.total} doc(s)</Badge>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
              {STAGES.map((s) => <Stat key={s.key} label={s.label} value={r.byStage[s.key] || 0} tone={s.tone} />)}
            </div>
            {r.missingOneTime > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3" /> {r.missingOneTime} of {r.expectedOneTime} one-time document(s) outstanding
              </div>
            )}
            {r.needsAttention && (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => copyReminder(r)}>
                <Copy className="w-3 h-3 mr-1" />Copy reminder message
              </Button>
            )}
            {r.tDocs.length > 0 && (
              <Button variant="ghost" size="sm" className="w-full h-8 text-xs" onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>
                {open === r.user_id ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                {open === r.user_id ? 'Hide documents' : `View ${r.tDocs.length} document(s)`}
              </Button>
            )}
            {open === r.user_id && (
              <div className="space-y-2">
                {[...r.tDocs].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
                  .map((d) => <DocumentCard key={d.id} doc={d} />)}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: 'muted' | 'primary' | 'destructive' | 'warning' }) {
  const cls =
    tone === 'destructive' ? 'text-destructive' :
    tone === 'warning' ? 'text-amber-600' :
    tone === 'primary' ? 'text-primary' : 'text-foreground';
  return (
    <div className="rounded border p-2">
      <p className={`text-base font-bold ${cls}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
