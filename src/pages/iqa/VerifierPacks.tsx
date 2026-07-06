// IQA / Super Admin page — generate shareable verification packs per department.
// A pack is a signed link (opaque token) an external verifier can use to
// download a ZIP of that department's archived documents for a given session.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/sessions';
import { Copy, Loader2, ShieldCheck, Link2, Ban } from 'lucide-react';

interface PackRow {
  id: string;
  department: string;
  session_year: number;
  session_term: string;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  download_count: number;
  created_at: string;
}

const TERMS = ['JAN_APR', 'MAY_AUG', 'SEP_DEC'];

export default function VerifierPacks() {
  const { currentUser, activeRole, loading } = useAuth();
  const [dept, setDept] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [term, setTerm] = useState<string>('JAN_APR');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PackRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');

  const load = async () => {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from('verification_packs' as never)
      .select('*')
      .order('created_at', { ascending: false });
    setLoadingRows(false);
    if (error) { toast.error('Failed to load packs', { description: error.message }); return; }
    setRows((data as unknown as PackRow[]) || []);
  };

  useEffect(() => { if (canUse) load(); }, [canUse]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!currentUser.roles.includes('IQA') && !currentUser.roles.includes('SUPER_ADMIN')) {
    return <Navigate to="/" replace />;
  }
  if (!canUse) {
    return (
      <div className="p-4"><Card><CardContent className="p-4 text-sm text-muted-foreground">
        Switch to <strong>IQA</strong> or <strong>Super Admin</strong> to manage verifier packs.
      </CardContent></Card></div>
    );
  }

  const generate = async () => {
    if (!dept || !year || !term) { toast.error('Fill department, year, and term'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-verification-pack', {
        body: { department: dept, session_year: year, session_term: term },
      });
      const errMsg = error?.message || (data as { error?: string })?.error;
      if (errMsg) { toast.error('Could not create pack', { description: errMsg }); return; }
      toast.success('Verifier pack created', { description: 'Share the link with your external verifier.' });
      load();
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from('verification_packs' as never)
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq('id' as never, id as never);
    if (error) { toast.error('Revoke failed', { description: error.message }); return; }
    toast.success('Pack revoked');
    load();
  };

  const linkFor = (token: string) =>
    `${window.location.origin}/verify/pack?token=${encodeURIComponent(token)}`;

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(linkFor(token));
    toast.success('Link copied to clipboard');
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Verifier Packs" subtitle="Generate shareable links for external verifiers, per department and session." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Create new pack
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-4 gap-3 items-end">
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Term</Label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TERMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={generate} disabled={busy} className="h-9 gap-1">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Generate link
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Existing packs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loadingRows && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loadingRows && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">No packs yet.</p>
          )}
          {rows.map((r) => {
            const expired = new Date(r.expires_at) < new Date();
            const revoked = !!r.revoked_at;
            const active = !expired && !revoked;
            return (
              <div key={r.id} className="border rounded p-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.department}</span>
                  <span className="text-muted-foreground">{r.session_year} · {r.session_term}</span>
                  {active && <Badge variant="secondary">Active</Badge>}
                  {revoked && <Badge variant="destructive">Revoked</Badge>}
                  {expired && !revoked && <Badge variant="outline">Expired</Badge>}
                  <span className="ml-auto text-muted-foreground">Downloads: {r.download_count}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[10px] truncate max-w-full break-all bg-muted px-2 py-1 rounded flex-1">{linkFor(r.token)}</code>
                  <Button size="sm" variant="outline" onClick={() => copyLink(r.token)} className="h-7 gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                  {active && (
                    <Button size="sm" variant="destructive" onClick={() => revoke(r.id)} className="h-7 gap-1">
                      <Ban className="w-3 h-3" /> Revoke
                    </Button>
                  )}
                </div>
                <div className="text-muted-foreground">
                  Expires {new Date(r.expires_at).toLocaleString()}
                  {revoked && ` · Revoked ${new Date(r.revoked_at!).toLocaleString()}`}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
