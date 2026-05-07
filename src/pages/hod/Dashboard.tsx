import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, AlertTriangle } from 'lucide-react';
import { ONE_TIME_DOC_TYPES } from '@/lib/sessions';

export default function HodDashboard() {
  const { currentUser } = useAuth();
  const dept = currentUser?.department || '';
  const [search, setSearch] = useState('');

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

  const rows = useMemo(() => {
    if (!data) return [];
    return data.trainers
      .filter((t) => !search || t.full_name?.toLowerCase().includes(search.toLowerCase()) || t.email?.toLowerCase().includes(search.toLowerCase()))
      .map((t) => {
        const tDocs = data.docs.filter((d) => d.trainer_id === t.user_id);
        const submitted = tDocs.filter((d) => d.status === 'SUBMITTED').length;
        const approved = tDocs.filter((d) => ['HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED'].includes(d.status)).length;
        const rejected = tDocs.filter((d) => d.status === 'REJECTED').length;
        const tConfigs = data.configs.filter((c) => c.trainer_id === t.user_id);
        const unitCount = new Set(tConfigs.map((c) => c.unit_code)).size;
        const expectedOneTime = unitCount * ONE_TIME_DOC_TYPES.length;
        const oneTimeSubmitted = tDocs.filter((d) => (ONE_TIME_DOC_TYPES as readonly string[]).includes(d.document_type)).length;
        const missingOneTime = Math.max(0, expectedOneTime - oneTimeSubmitted);
        return { ...t, submitted, approved, rejected, unitCount, missingOneTime, expectedOneTime };
      });
  }, [data, search]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Trainer Dashboard" subtitle={`${dept} • ${rows.length} trainer(s)`} />
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trainer…" className="pl-9" />
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No trainers found in this department.
        </CardContent></Card>
      ) : rows.map((r) => (
        <Card key={r.user_id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{r.full_name}</p>
                <p className="text-[11px] text-muted-foreground">{r.email}{r.pf_number ? ` • ${r.pf_number}` : ''}</p>
              </div>
              <Badge variant="secondary" className="text-[10px]">{r.unitCount} unit(s)</Badge>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <Stat label="Pending" value={r.submitted} tone="muted" />
              <Stat label="Approved" value={r.approved} tone="primary" />
              <Stat label="Rejected" value={r.rejected} tone="destructive" />
              <Stat label="Missing one-time" value={`${r.missingOneTime}/${r.expectedOneTime}`} tone={r.missingOneTime > 0 ? 'warning' : 'primary'} />
            </div>
            {r.missingOneTime > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3" /> {r.missingOneTime} one-time document(s) outstanding
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
