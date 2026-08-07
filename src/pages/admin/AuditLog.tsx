import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileDown, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { DeniedAttemptsAlert } from '@/components/admin/DeniedAttemptsAlert';

type UnifiedRow = {
  id: string;
  when: string;
  action: string;
  source: 'audit_logs' | 'role_change_audit' | 'security_events';
  affected_user_id: string | null;
  affected_email: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  details: string;
  denied?: boolean;
};

const DENIED_FILTER = 'DENIED (security)';

const ACTION_FILTERS = [
  'ALL',
  DENIED_FILTER,
  'STATUS_CHANGE',
  'DOCUMENT_STAMPED',
  'ROLE_ADDED',
  'ROLE_REMOVED',
  'DEPARTMENT_CHANGED',
  'GDRIVE_MIRRORED',
  'BACKUP_CREATED',
  'SYSTEM_RESTORED',
  'SYSTEM_RESET',
  'EARLY_DOWNLOAD',
  'SESSION_EXPORT',
];

export default function AuditLog() {
  const { currentUser, activeRole, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState(searchParams.get('denied') === '1' ? DENIED_FILTER : 'ALL');
  const [q, setQ] = useState('');
  const [exportingDenied, setExportingDenied] = useState(false);

  useEffect(() => {
    (async () => {
      setBusy(true);
      const [{ data: a }, { data: r }, { data: s }, { data: profiles }] = await Promise.all([
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('role_change_audit' as never).select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('security_events' as never).select('*').order('created_at' as never, { ascending: false }).limit(2000),
        supabase.from('profiles').select('user_id, email'),
      ]);
      const emailOf = new Map((profiles || []).map((p: any) => [p.user_id, p.email]));
      const merged: UnifiedRow[] = [
        ...((a || []).map((x: any) => ({
          id: `a-${x.id}`,
          when: x.created_at,
          action: x.action,
          source: 'audit_logs' as const,
          affected_user_id: x.details?.target_user_id ?? null,
          affected_email: x.details?.target_email ?? emailOf.get(x.details?.target_user_id) ?? null,
          performed_by: x.performed_by,
          performed_by_email: emailOf.get(x.performed_by) ?? null,
          details: JSON.stringify(x.details ?? {}),
        }))),
        ...((r || []).map((x: any) => ({
          id: `r-${x.id}`,
          when: x.created_at,
          action: x.action,
          source: 'role_change_audit' as const,
          affected_user_id: x.target_user_id,
          affected_email: x.target_email,
          performed_by: x.changed_by,
          performed_by_email: x.changed_by_email,
          details: `${x.old_value ?? ''} → ${x.new_value ?? ''}`,
        }))),
        ...(((s as any[]) || []).map((x: any) => ({
          id: `s-${x.id}`,
          when: x.created_at,
          action: x.action,
          source: 'security_events' as const,
          affected_user_id: x.details?.target_user_id ?? x.target_id ?? null,
          affected_email: emailOf.get(x.details?.target_user_id) ?? null,
          performed_by: x.actor_id,
          performed_by_email: x.actor_email ?? emailOf.get(x.actor_id) ?? null,
          details: `${x.target_table ?? ''} ${x.target_id ?? ''} — ${x.reason ?? 'blocked by access policy'}`.trim(),
          denied: true,
        }))),
      ].sort((a, b) => (a.when < b.when ? 1 : -1));
      setRows(merged);
      setBusy(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === DENIED_FILTER) { if (!r.denied) return false; }
      else if (filter !== 'ALL' && r.action !== filter) return false;
      if (q) {
        const needle = q.toLowerCase();
        return [r.action, r.affected_email, r.performed_by_email, r.details, r.affected_user_id]
          .filter(Boolean).some((s) => String(s).toLowerCase().includes(needle));
      }
      return true;
    });
  }, [rows, filter, q]);


  if (loading) return null;
  if (!currentUser?.roles.includes('SUPER_ADMIN')) return <Navigate to="/" replace />;
  if (activeRole !== 'SUPER_ADMIN') {
    return (
      <div className="p-4">
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Switch to the <strong>Super Admin</strong> role (top bar) to view the audit log.
        </CardContent></Card>
      </div>
    );
  }

  const exportCsv = () => {
    const headers = ['When', 'Action', 'Source', 'Affected user ID', 'Affected email', 'Performed by', 'Performed by email', 'Details'];
    const body = filtered.map((r) => [
      new Date(r.when).toLocaleString(), r.action, r.source,
      r.affected_user_id ?? '', r.affected_email ?? '',
      r.performed_by ?? '', r.performed_by_email ?? '',
      r.details,
    ]);
    const csv = [headers, ...body].map((row) =>
      row.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const toCsv = (rowsIn: (string | number)[][]) =>
    rowsIn.map((row) =>
      row.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')
    ).join('\n');

  const download = (csv: string, name: string) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    a.click(); URL.revokeObjectURL(url);
  };

  // Dedicated export of security_events (denied notification inserts, denied pack
  // deletions, etc.) straight from the source table so nothing is lost to UI filters.
  const exportDenied = async () => {
    setExportingDenied(true);
    try {
      const { data, error } = await supabase
        .from('security_events' as never)
        .select('*')
        .order('created_at' as never, { ascending: false })
        .limit(5000);
      if (error) throw error;
      const events = (data ?? []) as unknown as {
        id: string; created_at: string; actor_id: string | null; actor_email: string | null;
        action: string; target_table: string | null; target_id: string | null;
        reason: string | null; details: Record<string, unknown> | null;
      }[];
      if (events.length === 0) {
        toast({ title: 'Nothing to export', description: 'No security events recorded yet.' });
        return;
      }
      const headers = ['Event ID', 'When (local)', 'When (ISO)', 'Action', 'Actor user ID', 'Actor email', 'Target table', 'Target ID', 'Reason', 'Details JSON'];
      const body = events.map((e) => [
        e.id,
        new Date(e.created_at).toLocaleString(),
        e.created_at,
        e.action,
        e.actor_id ?? '',
        e.actor_email ?? '',
        e.target_table ?? '',
        e.target_id ?? '',
        e.reason ?? '',
        e.details ? JSON.stringify(e.details) : '',
      ]);
      download(toCsv([headers, ...body]), `denied-attempts-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: `Exported ${events.length} security event(s)` });
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setExportingDenied(false);
    }
  };


  return (
    <div className="space-y-3 pb-8">
      <PageHeader title="Audit Log" subtitle="Every create, role change, reset, export, delete, and denied attempt" />
      <DeniedAttemptsAlert />
      <Card><CardContent className="p-3 flex flex-wrap gap-2 items-center">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{ACTION_FILTERS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="flex-1 min-w-[200px] h-9" placeholder="Search email / details / user id" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
          <FileDown className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        {busy ? (
          <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto max-h-[70vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Affected user</TableHead>
                  <TableHead>Performed by</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className={r.denied ? 'bg-destructive/5' : undefined}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.when).toLocaleString()}</TableCell>
                    <TableCell className="space-x-1">
                      {r.denied && <Badge variant="destructive" className="text-[10px]">DENIED</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{r.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.affected_email || r.affected_user_id || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{r.performed_by_email || r.performed_by || <span className="text-muted-foreground">system</span>}</TableCell>
                    <TableCell className="text-xs max-w-[400px] truncate" title={r.details}>{r.details}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No matching records</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
