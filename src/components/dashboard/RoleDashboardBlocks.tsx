// Role-aware dashboard blocks fed by real DB data. Rendered from Dashboard.tsx
// based on the caller's activeRole. Kept intentionally small — each block runs
// its own query so a slow one never blocks the others.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldAlert, Archive, Users, Clock, RotateCcw } from 'lucide-react';
import { SystemResetCard } from '@/components/admin/SystemResetCard';
import { DeniedAttemptsAlert } from '@/components/admin/DeniedAttemptsAlert';

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'warn' | 'ok' }) {
  const cls = tone === 'warn' ? 'text-destructive' : tone === 'ok' ? 'text-primary' : '';
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

/* ---------------- HOD ---------------- */
export function HodBlock({ department }: { department: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-hod', department],
    enabled: !!department,
    queryFn: async () => {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, status, submitted_at, hod_approved_at, trainer_id')
        .eq('department', department);
      return docs || [];
    },
  });
  if (isLoading) return <BlockLoader />;
  const rows = data || [];
  const pending = rows.filter((d) => d.status === 'SUBMITTED');
  const approved30 = rows.filter((d) => d.hod_approved_at && hoursSince(d.hod_approved_at) < 24 * 30);
  const avgHrs = approved30.length
    ? approved30.reduce((s, d) => s + (hoursSince(d.submitted_at) - hoursSince(d.hod_approved_at!)), 0) / approved30.length
    : 0;
  const oldest = pending.reduce((max, d) => Math.max(max, hoursSince(d.submitted_at)), 0);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Department queue</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <Stat label="Pending" value={pending.length} tone={pending.length > 5 ? 'warn' : 'default'} />
        <Stat label="Avg time (30d)" value={`${avgHrs.toFixed(1)}h`} />
        <Stat label="Oldest waiting" value={`${oldest.toFixed(1)}h`} tone={oldest > 48 ? 'warn' : 'default'} />
      </CardContent>
    </Card>
  );
}

/* ---------------- DP ---------------- */
export function DpBlock() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-dp'],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('id, department, status, hod_approved_at, dp_approved_at, submitted_at')
        .in('status', ['HOD_APPROVED', 'DP_APPROVED']);
      return data || [];
    },
  });
  if (isLoading) return <BlockLoader />;
  const rows = data || [];
  const pending = rows.filter((d) => d.status === 'HOD_APPROVED');
  const byDept: Record<string, number> = {};
  pending.forEach((d) => { byDept[d.department] = (byDept[d.department] || 0) + 1; });
  const deptEntries = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
  const oldest = pending.reduce((max, d) => Math.max(max, d.hod_approved_at ? hoursSince(d.hod_approved_at) : 0), 0);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Cross-department queue</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Awaiting DP" value={pending.length} tone={pending.length > 10 ? 'warn' : 'default'} />
          <Stat label="Oldest waiting" value={`${oldest.toFixed(1)}h`} tone={oldest > 48 ? 'warn' : 'default'} />
        </div>
        {deptEntries.length > 0 && (
          <div className="text-xs space-y-1">
            <p className="text-muted-foreground">By department:</p>
            {deptEntries.slice(0, 5).map(([d, c]) => (
              <div key={d} className="flex justify-between"><span>{d}</span><Badge variant="secondary">{c}</Badge></div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- IQAO ---------------- */
export function IqaBlock() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-iqa'],
    queryFn: async () => {
      const [docsRes, packsRes] = await Promise.all([
        supabase.from('documents').select('id, department, status, dp_approved_at').in('status', ['DP_APPROVED', 'ARCHIVED']),
        supabase.from('verification_packs' as never).select('id, department, revoked_at, expires_at, download_count, created_at'),
      ]);
      return { docs: (docsRes.data as { id: string; department: string; status: string; dp_approved_at: string | null }[]) || [], packs: (packsRes.data as { id: string; department: string; revoked_at: string | null; expires_at: string; download_count: number; created_at: string }[]) || [] };
    },
  });
  if (isLoading) return <BlockLoader />;
  const rows = data!;
  const pending = rows.docs.filter((d) => d.status === 'DP_APPROVED');
  const now = Date.now();
  const activePacks = rows.packs.filter((p) => !p.revoked_at && new Date(p.expires_at).getTime() > now);
  const dl7 = rows.packs.filter((p) => now - new Date(p.created_at).getTime() < 7 * 86400_000)
    .reduce((s, p) => s + (p.download_count || 0), 0);
  const byDept: Record<string, number> = {};
  pending.forEach((d) => { byDept[d.department] = (byDept[d.department] || 0) + 1; });

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Archive className="w-4 h-4 text-primary" /> Archive & packs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Awaiting archive" value={pending.length} tone={pending.length > 10 ? 'warn' : 'default'} />
          <Stat label="Active packs" value={activePacks.length} />
          <Stat label="DL last 7d" value={dl7} />
        </div>
        {Object.keys(byDept).length > 0 && (
          <div className="text-xs space-y-1">
            <p className="text-muted-foreground">Pending by department:</p>
            {Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, c]) => (
              <div key={d} className="flex justify-between"><span>{d}</span><Badge variant="secondary">{c}</Badge></div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Super Admin ---------------- */
export function SuperAdminBlock() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-superadmin'],
    queryFn: async () => {
      const [docsRes, rolesRes, backupRes, resetRes] = await Promise.all([
        supabase.from('documents').select('status, storage_tier'),
        supabase.from('user_roles').select('role'),
        supabase.from('backup_metadata' as never).select('created_at').order('created_at', { ascending: false }).limit(1),
        supabase.from('audit_logs').select('created_at').eq('action', 'SYSTEM_RESET').order('created_at', { ascending: false }).limit(1),
      ]);
      return {
        docs: (docsRes.data as { status: string; storage_tier: string }[]) || [],
        roles: (rolesRes.data as { role: string }[]) || [],
        lastBackup: (backupRes.data as { created_at: string }[] | null)?.[0]?.created_at || null,
        lastReset: (resetRes.data as { created_at: string }[] | null)?.[0]?.created_at || null,
      };
    },
  });
  if (isLoading) return <BlockLoader />;
  const d = data!;
  const byStatus: Record<string, number> = {};
  d.docs.forEach((x) => { byStatus[x.status] = (byStatus[x.status] || 0) + 1; });
  const cloud = d.docs.filter((x) => x.storage_tier !== 'drive').length;
  const drive = d.docs.filter((x) => x.storage_tier === 'drive').length;
  const rolesByType: Record<string, number> = {};
  d.roles.forEach((r) => { rolesByType[r.role] = (rolesByType[r.role] || 0) + 1; });

  return (
    <div className="space-y-4">
      <DeniedAttemptsAlert />
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-primary" /> System overview</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Submitted" value={byStatus.SUBMITTED || 0} />
            <Stat label="HOD approved" value={byStatus.HOD_APPROVED || 0} />
            <Stat label="DP approved" value={byStatus.DP_APPROVED || 0} />
            <Stat label="Archived" value={byStatus.ARCHIVED || 0} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="border rounded p-2">
              <p className="text-muted-foreground">Storage split</p>
              <p><strong>{cloud}</strong> in cloud · <strong>{drive}</strong> on Drive</p>
            </div>
            <div className="border rounded p-2">
              <p className="text-muted-foreground">Users by role</p>
              <p>{Object.entries(rolesByType).map(([r, c]) => `${r}: ${c}`).join(' · ') || '—'}</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
            <div>Last backup: {d.lastBackup ? new Date(d.lastBackup).toLocaleString() : '—'}</div>
            <div>Last reset: {d.lastReset ? new Date(d.lastReset).toLocaleString() : '—'}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/setup" className="text-xs underline">System setup</Link>
            <Link to="/admin/backups" className="text-xs underline">Backups</Link>
            <Link to="/admin/audit" className="text-xs underline">Audit log</Link>
            <Link to="/admin/efficiency" className="text-xs underline">Efficiency</Link>
          </div>
        </CardContent>
      </Card>

      <details className="border rounded p-3">
        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2 text-destructive">
          <RotateCcw className="w-4 h-4" /> Reset system to zero data
        </summary>
        <div className="pt-3">
          <SystemResetCard />
        </div>
      </details>
    </div>
  );
}

function BlockLoader() {
  return (
    <Card><CardContent className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></CardContent></Card>
  );
}
