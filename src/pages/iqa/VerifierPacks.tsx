// IQAO / Super Admin — generate shareable verifier packs per department.
// Also hosts the analytics panel, composition controls, verifier assignments,
// and per-pack review summary.

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/sessions';
import { Copy, Loader2, ShieldCheck, Link2, Ban, Users, MessageSquare, Settings2, ListChecks, Trash2 } from 'lucide-react';
import { PackAnalyticsPanel } from '@/components/iqa/PackAnalyticsPanel';
import { AssignVerifiersModal } from '@/components/iqa/AssignVerifiersModal';
import { useDocTypePolicies, policyFor } from '@/hooks/useDocTypePolicy';
import { logSecurityEvent, isPermissionDenied } from '@/lib/securityEvents';

interface PackRow {
  id: string; department: string; session_year: number; session_term: string;
  token: string; expires_at: string; revoked_at: string | null;
  download_count: number; created_at: string;
  included_document_types: string[] | null;
  include_text_only_fallbacks: boolean;
}

interface ReviewCount { pack_id: string; count: number }

const TERMS = ['JAN_APR', 'MAY_AUG', 'SEP_DEC'];
const DOC_TYPES = [
  'Learning Plan', 'Personal Timetable', 'Workload Allocation',
  'Session Plan', 'Class Attendance', 'Course Outline',
];

export default function VerifierPacks() {
  const { currentUser, activeRole, loading } = useAuth();
  const { data: policies } = useDocTypePolicies();

  const [dept, setDept] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [term, setTerm] = useState<string>('JAN_APR');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(DOC_TYPES);
  const [includeTextOnly, setIncludeTextOnly] = useState(true);
  const [includeDpApproved, setIncludeDpApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PackRow[]>([]);
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const [loadingRows, setLoadingRows] = useState(false);
  const [assignModal, setAssignModal] = useState<PackRow | null>(null);
  const [eligible, setEligible] = useState<{ archived: number; dpApproved: number } | null>(null);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');
  const canGenerate = !!dept && !!year && !!term && selectedTypes.length > 0 && !busy;

  // Live eligibility preview — counts documents that would land in the pack.
  useEffect(() => {
    if (!canUse || !dept || !year || !term) { setEligible(null); return; }
    let cancelled = false;
    (async () => {
      let q = supabase.from('documents')
        .select('status', { count: 'exact', head: false })
        .eq('department', dept)
        .eq('session_year', year)
        .eq('session_term', term)
        .in('status', ['ARCHIVED', 'DP_APPROVED']);
      if (selectedTypes.length < DOC_TYPES.length) q = q.in('document_type', selectedTypes as never);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data as { status: string }[] | null) || [];
      setEligible({
        archived: rows.filter((r) => r.status === 'ARCHIVED').length,
        dpApproved: rows.filter((r) => r.status === 'DP_APPROVED').length,
      });
    })();
    return () => { cancelled = true; };
  }, [canUse, dept, year, term, selectedTypes]);

  // If every selected type forbids text-only fallback, force the switch off + disable.
  const allSelectedForbidTextOnly = useMemo(() => {
    if (selectedTypes.length === 0) return false;
    return selectedTypes.every((t) => policyFor(policies, t).forbid_text_only_fallback);
  }, [selectedTypes, policies]);
  useEffect(() => {
    if (allSelectedForbidTextOnly && includeTextOnly) setIncludeTextOnly(false);
  }, [allSelectedForbidTextOnly, includeTextOnly]);

  const load = async () => {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from('verification_packs' as never)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { toast.error('Failed to load packs', { description: error.message }); setLoadingRows(false); return; }
    const list = (data as unknown as PackRow[]) || [];
    setRows(list);

    if (list.length) {
      // deno-lint-ignore no-explicit-any
      const { data: rc } = await (supabase as any)
        .from('verifier_reviews')
        .select('pack_id')
        .in('pack_id', list.map((r) => r.id));
      const counts: Record<string, number> = {};
      ((rc as { pack_id: string }[] | null) || []).forEach((r) => {
        counts[r.pack_id] = (counts[r.pack_id] || 0) + 1;
      });
      setReviewCounts(counts);
    }
    setLoadingRows(false);
  };

  useEffect(() => { if (canUse) load(); }, [canUse]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!currentUser.roles.includes('IQA') && !currentUser.roles.includes('SUPER_ADMIN')) {
    return <Navigate to="/" replace />;
  }
  if (!canUse) {
    return <div className="p-4"><Card><CardContent className="p-4 text-sm text-muted-foreground">
      Switch to <strong>IQAO</strong> or <strong>Super Admin</strong> to manage verifier packs.
    </CardContent></Card></div>;
  }

  const toggleType = (t: string) => {
    setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const generate = async () => {
    if (!canGenerate) { toast.error('Pick department, year, term, and at least one type'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-verification-pack', {
        body: {
          department: dept, session_year: year, session_term: term,
          included_document_types: selectedTypes.length === DOC_TYPES.length ? null : selectedTypes,
          include_text_only_fallbacks: includeTextOnly,
          include_dp_approved: includeDpApproved,
        },
      });
      // Surface both invoke error and function-level error body
      // deno-lint-ignore no-explicit-any
      const ctxBody = (error as any)?.context?.body;
      const errMsg = (data as { error?: string })?.error || ctxBody || error?.message;
      if (errMsg) { toast.error('Could not create pack', { description: String(errMsg) }); return; }
      toast.success('Verifier pack created');
      load();
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from('verification_packs' as never)
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq('id' as never, id as never);
    if (error) {
      if (isPermissionDenied(error)) {
        await logSecurityEvent({
          action: 'DENIED_PACK_REVOKE', targetTable: 'verification_packs',
          targetId: id, reason: error.message,
        });
      }
      toast.error('Revoke failed', { description: error.message }); return;
    }
    toast.success('Pack revoked');
    load();
  };

  const destroy = async (id: string) => {
    if (!window.confirm('Permanently delete this pack? Revoking is usually enough — this cannot be undone.')) return;
    const { error } = await supabase
      .from('verification_packs' as never)
      .delete()
      .eq('id' as never, id as never);
    if (error) {
      if (isPermissionDenied(error)) {
        await logSecurityEvent({
          action: 'DENIED_PACK_DELETE', targetTable: 'verification_packs',
          targetId: id, reason: error.message,
        });
      }
      toast.error('Delete failed', { description: 'Only a Super Admin can permanently delete packs. This attempt has been logged.' });
      return;
    }
    toast.success('Pack deleted permanently');
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
      <PageHeader title="Verifier Packs" subtitle="Shareable links for external verifiers, per department and session." />
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="h-8 gap-1">
          <Link to="/iqa/pack-capacity"><Settings2 className="w-3 h-3" /> Capacity settings</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8 gap-1">
          <Link to="/iqa/bulk-assign"><ListChecks className="w-3 h-3" /> Bulk assign</Link>
        </Button>
      </div>

      <PackAnalyticsPanel />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Create new pack
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
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
                <SelectContent>{TERMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={generate} disabled={!canGenerate} className="h-9 gap-1">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Generate link
            </Button>
          </div>

          {eligible && (
            <div className={`text-xs rounded border p-2 ${eligible.archived + (includeDpApproved ? eligible.dpApproved : 0) === 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-muted/30'}`}>
              <p><strong>Eligible now:</strong> {eligible.archived} archived
                {includeDpApproved ? ` + ${eligible.dpApproved} DP-approved` : ''} document(s).</p>
              {eligible.archived + (includeDpApproved ? eligible.dpApproved : 0) === 0 && (
                <p className="mt-1">
                  No documents match — <Link to="/iqa/archive" className="underline">archive DP-approved docs</Link> first,
                  or enable "Include DP-approved" below.
                </p>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 border rounded p-3">
            <Switch checked={includeDpApproved} onCheckedChange={setIncludeDpApproved} />
            <div className="text-xs">
              <p>Include DP-approved (not yet archived)</p>
              <p className="text-muted-foreground text-[10px]">
                Lets external verifiers review documents before final IQAO archival. Off = only fully archived docs.
              </p>
            </div>
          </div>


          <div className="border rounded p-3 space-y-2">
            <Label className="text-xs">Included document types</Label>
            <div className="grid sm:grid-cols-2 gap-1">
              {DOC_TYPES.map((t) => {
                const forbids = policyFor(policies, t).forbid_text_only_fallback;
                return (
                  <label key={t} className="flex items-start gap-2 text-xs">
                    <Checkbox checked={selectedTypes.includes(t)} onCheckedChange={() => toggleType(t)} />
                    <span>
                      {t}
                      {forbids && <span className="ml-1 text-[10px] text-muted-foreground">(policy: no text-only)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-start gap-2 pt-1">
              <Switch checked={includeTextOnly} disabled={allSelectedForbidTextOnly} onCheckedChange={setIncludeTextOnly} />
              <div className="text-xs">
                <p>Include text-only-approved documents</p>
                <p className="text-muted-foreground text-[10px]">
                  {allSelectedForbidTextOnly
                    ? 'All selected types forbid text-only approvals — this is off automatically.'
                    : 'Off = only documents with a physical stamp / signature are bundled.'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Existing packs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loadingRows && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loadingRows && rows.length === 0 && <p className="text-xs text-muted-foreground">No packs yet.</p>}
          {rows.map((r) => {
            const expired = new Date(r.expires_at) < new Date();
            const revoked = !!r.revoked_at;
            const active = !expired && !revoked;
            const revs = reviewCounts[r.id] || 0;
            return (
              <div key={r.id} className="border rounded p-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.department}</span>
                  <span className="text-muted-foreground">{r.session_year} · {r.session_term}</span>
                  {active && <Badge variant="secondary">Active</Badge>}
                  {revoked && <Badge variant="destructive">Revoked</Badge>}
                  {expired && !revoked && <Badge variant="outline">Expired</Badge>}
                  {r.included_document_types && <Badge variant="outline" className="text-[10px]">{r.included_document_types.length} types</Badge>}
                  {!r.include_text_only_fallbacks && <Badge variant="outline" className="text-[10px]">no text-only</Badge>}
                  <span className="ml-auto text-muted-foreground">DL {r.download_count} · Reviews {revs}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[10px] truncate max-w-full break-all bg-muted px-2 py-1 rounded flex-1">{linkFor(r.token)}</code>
                  <Button size="sm" variant="outline" onClick={() => copyLink(r.token)} className="h-7 gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                  {active && (
                    <Button size="sm" variant="outline" onClick={() => setAssignModal(r)} className="h-7 gap-1">
                      <Users className="w-3 h-3" /> Assign
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline" className="h-7 gap-1">
                    <Link to={`/iqa/packs/${r.id}/reviews`}><MessageSquare className="w-3 h-3" /> Reviews</Link>
                  </Button>
                  {active && (
                    <Button size="sm" variant="destructive" onClick={() => revoke(r.id)} className="h-7 gap-1">
                      <Ban className="w-3 h-3" /> Revoke
                    </Button>
                  )}
                  {currentUser?.roles.includes('SUPER_ADMIN') && (
                    <Button size="sm" variant="ghost" onClick={() => destroy(r.id)} className="h-7 gap-1 text-destructive">
                      <Trash2 className="w-3 h-3" /> Delete
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

      {assignModal && (
        <AssignVerifiersModal
          packId={assignModal.id}
          packToken={assignModal.token}
          department={assignModal.department}
          open={!!assignModal}
          onClose={() => setAssignModal(null)}
        />
      )}
    </div>
  );
}
