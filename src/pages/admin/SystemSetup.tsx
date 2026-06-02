import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, Circle, ShieldCheck, Users, Building2, FileDown, Loader2, AlertTriangle } from 'lucide-react';
import { DEPARTMENTS } from '@/lib/sessions';
import { Link, Navigate } from 'react-router-dom';

const SUPER_ADMIN_EMAIL = 'tonny.omondi@nyamirapoly.ac.ke';
const ALL_ROLES: UserRole[] = ['TRAINER', 'HOD', 'DP_ACADEMICS', 'IQA', 'SUPER_ADMIN'];

interface AuditRow {
  id: string;
  created_at: string;
  target_email: string | null;
  target_name: string | null;
  action: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_email: string | null;
}

export default function SystemSetup() {
  const { currentUser, loading: authLoading } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [hasSuperAdmin, setHasSuperAdmin] = useState<boolean | null>(null);
  const [confirmType, setConfirmType] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [resetText, setResetText] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN');
  const todayKey = new Date().toISOString().slice(0, 10);

  const checkSuperAdmin = async () => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'SUPER_ADMIN');
    if (!error) {
      // head:true returns no data; use count via separate query
      const { count } = await supabase
        .from('user_roles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'SUPER_ADMIN');
      setHasSuperAdmin((count ?? 0) > 0);
    }
  };

  const loadUsers = async () => {
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    setUsers(
      (profiles || []).map((p: any) => ({
        ...p,
        roles: (roles || []).filter((r: any) => r.user_id === p.user_id).map((r: any) => r.role),
      })),
    );
  };

  const loadAudit = async () => {
    const { data } = await supabase
      .from('role_change_audit' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    setAudit((data as any) || []);
  };

  useEffect(() => {
    checkSuperAdmin();
  }, []);
  useEffect(() => {
    if (hasSuperAdmin) {
      loadUsers();
      loadAudit();
    }
  }, [hasSuperAdmin]);

  if (authLoading) return null;

  // Allow access if: no super admin yet (bootstrap), or current user is super admin
  const allowed = hasSuperAdmin === false || isSuperAdmin;
  if (hasSuperAdmin !== null && !allowed) return <Navigate to="/" replace />;

  const handleBootstrap = async () => {
    if (confirmType.trim().toUpperCase() !== 'CONFIRM') {
      toast({ title: 'Type CONFIRM to proceed', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('bootstrap_super_admin' as never, {
      target_email: SUPER_ADMIN_EMAIL,
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Super Admin assigned', description: SUPER_ADMIN_EMAIL });
      setHasSuperAdmin(true);
      setStep(2);
    }
  };

  const handleReset = async () => {
    if (resetText.trim() !== `RESET ${todayKey}`) {
      toast({ title: 'Confirmation text mismatch', description: `Type exactly: RESET ${todayKey}`, variant: 'destructive' });
      return;
    }
    setResetBusy(true);
    const { data, error } = await supabase.functions.invoke('system-reset', { body: { confirm: resetText.trim() } });
    setResetBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Reset failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
    } else {
      toast({ title: 'System reset complete', description: 'All documents, configs and audit data cleared.' });
      setResetText('');
      loadUsers(); loadAudit();
    }
  };

  const addRole = async (userId: string, role: UserRole) => {
    const { error } = await supabase.from('user_roles').insert({ user_id: userId, role });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Role added' }); loadUsers(); loadAudit(); }
  };

  const setDept = async (userId: string, department: string) => {
    const { error } = await supabase.from('profiles').update({ department }).eq('user_id', userId);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Department updated' }); loadUsers(); loadAudit(); }
  };

  const exportAudit = () => {
    const headers = ['When', 'Action', 'Target user', 'Target email', 'Old', 'New', 'Changed by'];
    const rows = audit.map((a) => [
      new Date(a.created_at).toLocaleString(),
      a.action,
      a.target_name || '',
      a.target_email || '',
      a.old_value || '',
      a.new_value || '',
      a.changed_by_email || '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `role-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Department coverage
  const deptCoverage = DEPARTMENTS.map((d) => ({
    name: d,
    hodCount: users.filter((u) => u.department === d && u.roles.includes('HOD')).length,
    trainerCount: users.filter((u) => u.department === d && u.roles.includes('TRAINER')).length,
  }));

  const stepDone = {
    1: hasSuperAdmin === true,
    2: deptCoverage.some((d) => d.hodCount > 0),
    3: users.some((u) => u.roles.includes('DP_ACADEMICS')) && users.some((u) => u.roles.includes('IQA')),
  };

  return (
    <div className="space-y-4">
      <PageHeader title="System Setup Wizard" subtitle="Configure your EDMS in three guided steps" />

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {[
          { n: 1, label: 'Super Admin', icon: ShieldCheck },
          { n: 2, label: 'Departments', icon: Building2 },
          { n: 3, label: 'Roles', icon: Users },
          { n: 4, label: 'Audit', icon: FileDown },
          ...(isSuperAdmin ? [{ n: 5, label: 'Danger Zone', icon: AlertTriangle }] : []),
        ].map((s) => {
          const done = (stepDone as Record<number, boolean>)[s.n] ?? false;
          const active = step === s.n;
          return (
            <button
              key={s.n}
              onClick={() => setStep(s.n as 1 | 2 | 3 | 4 | 5)}
              className={`flex-1 flex items-center gap-2 p-2 rounded border ${
                active ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              {done ? (
                <CheckCircle2 className="w-4 h-4 text-primary" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="font-medium">{s.n}. {s.label}</span>
            </button>
          );
        })}
      </div>

      {/* STEP 1: Super Admin */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Initial Super Admin
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasSuperAdmin ? (
              <div className="text-sm text-muted-foreground">
                ✓ A Super Admin is already configured. You can move on to the next step.
              </div>
            ) : (
              <>
                <p className="text-sm">
                  The designated Super Admin email is <strong>{SUPER_ADMIN_EMAIL}</strong>. That account must have signed up at least once.
                </p>
                <Input value={SUPER_ADMIN_EMAIL} disabled />
                <Input
                  placeholder='Type CONFIRM to enable'
                  value={confirmType}
                  onChange={(e) => setConfirmType(e.target.value)}
                />
                <Button onClick={handleBootstrap} disabled={busy || confirmType.trim().toUpperCase() !== 'CONFIRM'}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirm & Enable Super Admin
                </Button>
              </>
            )}
            {hasSuperAdmin && (
              <Button onClick={() => setStep(2)}>Next: Departments →</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Departments */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Department Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Each department should have at least one HOD and trainers assigned.
            </p>
            {deptCoverage.map((d) => (
              <div key={d.name} className="flex justify-between items-center p-2 rounded border text-sm">
                <span className="font-medium">{d.name}</span>
                <div className="flex gap-2">
                  <Badge variant={d.hodCount > 0 ? 'default' : 'secondary'}>
                    {d.hodCount} HOD
                  </Badge>
                  <Badge variant="secondary">{d.trainerCount} trainers</Badge>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-3">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={() => setStep(3)}>Next: Roles →</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Roles */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Assign Roles & Departments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {users.map((u) => {
              const available = ALL_ROLES.filter((r) => !u.roles.includes(r));
              return (
                <div key={u.user_id} className="p-2 rounded border space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium">{u.full_name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 max-w-[50%] justify-end">
                      {u.roles.map((r: string) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Select value={u.department || ''} onValueChange={(v) => setDept(u.user_id, v)}>
                      <SelectTrigger className="h-8 text-xs flex-1 min-w-[160px]">
                        <SelectValue placeholder="Department" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {available.length > 0 && (
                      <Select onValueChange={(v) => addRole(u.user_id, v as UserRole)}>
                        <SelectTrigger className="h-8 text-xs w-[140px]">
                          <SelectValue placeholder="Add role" />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between pt-3">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button onClick={() => setStep(4)}>View Audit Trail →</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: Audit */}
      {step === 4 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Role & Department Audit Trail</CardTitle>
            <Button size="sm" variant="outline" onClick={exportAudit} disabled={audit.length === 0}>
              <FileDown className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {audit.map((a) => (
                  <div key={a.id} className="text-xs p-2 rounded border">
                    <div className="flex justify-between">
                      <span className="font-medium">{a.action}</span>
                      <span className="text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      <strong>{a.target_name || a.target_email}</strong>
                      {a.action === 'DEPARTMENT_CHANGED'
                        ? `: ${a.old_value || '(none)'} → ${a.new_value || '(none)'}`
                        : `: ${a.new_value || a.old_value}`}
                    </div>
                    <div className="text-muted-foreground">
                      by {a.changed_by_email || 'system'}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-3">
              <Button asChild variant="outline">
                <Link to="/admin/users">Open full user manager</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 5: Danger Zone (SUPER_ADMIN only) */}
      {step === 5 && isSuperAdmin && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              Danger Zone — Reset All Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This deletes <strong>all</strong> documents, audit logs, unit configs, teaching assignments, and uploaded files.
              User accounts, roles, and Super Admin are preserved.
            </p>
            <p className="text-sm">
              To confirm, type exactly: <code className="bg-muted px-1.5 py-0.5 rounded">RESET {todayKey}</code>
            </p>
            <Input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder={`RESET ${todayKey}`} />
            <Button variant="destructive" onClick={handleReset} disabled={resetBusy || resetText.trim() !== `RESET ${todayKey}`}>
              {resetBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Permanently reset system
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
