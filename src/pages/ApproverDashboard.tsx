// Session dashboard: per-approver pending / approved / archived counts with a
// per-session target (session_approver_targets, editable by Super Admin).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getCurrentSession, getSessionOptions, sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useCurrentSession } from '@/hooks/useAcademicSession';

type Stage = 'HOD' | 'DP' | 'IQA';
const STAGE_LABEL: Record<Stage, string> = { HOD: 'HOD (verify)', DP: 'DP Academics (approve)', IQA: 'IQAO (review & archive)' };
const ROLE_STAGE: Record<string, Stage> = { HOD: 'HOD', DP_ACADEMICS: 'DP', IQA: 'IQA' };

interface Doc {
  id: string; department: string; status: string;
  hod_approved_by: string | null; dp_approved_by: string | null;
  iqa_reviewed_by: string | null; iqa_archived_by: string | null;
}

export default function ApproverDashboard() {
  const { currentUser, activeRole } = useAuth();
  const qc = useQueryClient();
  const isAdmin = activeRole === 'SUPER_ADMIN';
  const cur = getCurrentSession();
  const options = useMemo(() => getSessionOptions(), []);
  const { data: adminSession } = useCurrentSession();
  const [year, setYear] = useState(cur.year);
  const [term, setTerm] = useState<SessionTerm>(cur.term);
  useEffect(() => {
    if (adminSession) { setYear(adminSession.session_year); setTerm(adminSession.session_term as SessionTerm); }
  }, [adminSession]);

  const { data, isLoading } = useQuery({
    queryKey: ['approver-dashboard', year, term],
    queryFn: async () => {
      const [docs, roles, profiles, targets] = await Promise.all([
        supabase.from('documents')
          .select('id, department, status, hod_approved_by, dp_approved_by, iqa_reviewed_by, iqa_archived_by')
          .eq('session_year', year).eq('session_term', term),
        supabase.from('user_roles').select('user_id, role').in('role', ['HOD', 'DP_ACADEMICS', 'IQA']),
        supabase.from('profiles').select('user_id, full_name, department'),
        supabase.from('session_approver_targets' as never).select('*').eq('session_year', year).eq('session_term', term),
      ]);
      return {
        docs: (docs.data || []) as unknown as Doc[],
        roles: roles.data || [],
        profiles: profiles.data || [],
        targets: (targets.data || []) as unknown as { stage: string; department: string; target: number }[],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const docs = data.docs;
    return data.roles.map((r) => {
      const stage = ROLE_STAGE[r.role];
      const p = data.profiles.find((x) => x.user_id === r.user_id);
      const dept = stage === 'HOD' ? p?.department || '' : '';
      let pending = 0, approved = 0, archived = 0;
      if (stage === 'HOD') {
        pending = docs.filter((d) => d.status === 'SUBMITTED' && d.department === dept).length;
        approved = docs.filter((d) => d.hod_approved_by === r.user_id).length;
        archived = docs.filter((d) => d.hod_approved_by === r.user_id && ['ARCHIVED', 'EXPORTED'].includes(d.status)).length;
      } else if (stage === 'DP') {
        pending = docs.filter((d) => d.status === 'IQA_REVIEWED').length;
        approved = docs.filter((d) => d.dp_approved_by === r.user_id).length;
        archived = docs.filter((d) => d.dp_approved_by === r.user_id && ['ARCHIVED', 'EXPORTED'].includes(d.status)).length;
      } else {
        pending = docs.filter((d) => d.status === 'HOD_APPROVED' || d.status === 'DP_APPROVED').length;
        approved = docs.filter((d) => d.iqa_reviewed_by === r.user_id).length;
        archived = docs.filter((d) => d.iqa_archived_by === r.user_id).length;
      }
      const t = data.targets.find((x) => x.stage === stage && x.department === dept);
      // Default target: every document of the session that reaches this stage's scope.
      const fallback = stage === 'HOD' ? docs.filter((d) => d.department === dept && d.status !== 'REJECTED').length
        : docs.filter((d) => d.status !== 'REJECTED').length;
      const target = t?.target ?? fallback;
      const done = stage === 'IQA' ? archived : approved;
      return {
        key: `${r.user_id}-${r.role}`, stage, dept, name: p?.full_name || 'Unknown', pending, approved, archived,
        target, isCustom: !!t, pct: target ? Math.min(100, Math.round((done / target) * 100)) : 0,
      };
    })
      .filter((r) => activeRole === 'SUPER_ADMIN' || activeRole === 'DP_ACADEMICS' || activeRole === 'IQA'
        || (activeRole === 'HOD' && (r.stage !== 'HOD' || r.dept === currentUser?.department)))
      .sort((a, b) => a.stage.localeCompare(b.stage) || a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));
  }, [data, activeRole, currentUser?.department]);

  const saveTarget = async (stage: Stage, dept: string, value: number) => {
    const { error } = await supabase.from('session_approver_targets' as never).upsert({
      session_year: year, session_term: term, stage, department: dept, target: Math.max(0, value),
      updated_by: currentUser?.id, updated_at: new Date().toISOString(),
    } as never, { onConflict: 'session_year,session_term,stage,department' });
    if (error) toast({ title: 'Could not save target', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Target saved' }); qc.invalidateQueries({ queryKey: ['approver-dashboard'] }); }
  };

  return (
    <div className="pb-8">
      <PageHeader title="Approver session dashboard" subtitle={sessionLabel(year, term)} />
      <Select value={`${year}_${term}`} onValueChange={(v) => { setYear(Number(v.split('_')[0])); setTerm(v.substring(v.indexOf('_') + 1) as SessionTerm); }}>
        <SelectTrigger className="mb-4"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={`${o.year}_${o.term}`} value={`${o.year}_${o.term}`}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground mb-3">
        Progress counts approvals (HOD, DP) or archives (IQAO) against the session target.
        {isAdmin ? ' Edit a target and press Enter to save.' : ''} Without a set target, the number of live documents in scope is used.
      </p>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : (
        <div className="space-y-3">
          {rows.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No approvers found.</CardContent></Card>}
          {rows.map((r) => (
            <Card key={r.key}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{STAGE_LABEL[r.stage]}{r.dept ? ` • ${r.dept}` : ''}</p>
                  </div>
                  <Badge variant={r.pct >= 100 ? 'default' : 'secondary'}>{r.pct >= 100 ? 'Target reached' : `${r.pct}%`}</Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[['Pending', r.pending], ['Approved', r.approved], ['Archived', r.archived]].map(([l, v]) => (
                    <div key={l as string}><p className="text-lg font-bold">{v}</p><p className="text-[10px] text-muted-foreground">{l}</p></div>
                  ))}
                  <div>
                    {isAdmin ? (
                      <Input type="number" min={0} defaultValue={r.target} className="h-8 text-center"
                        aria-label="Session target"
                        onKeyDown={(e) => { if (e.key === 'Enter') saveTarget(r.stage, r.dept, Number((e.target as HTMLInputElement).value) || 0); }} />
                    ) : <p className="text-lg font-bold">{r.target}</p>}
                    <p className="text-[10px] text-muted-foreground">Target{r.isCustom ? '' : ' (auto)'}</p>
                  </div>
                </div>
                <Progress value={r.pct} className="h-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
