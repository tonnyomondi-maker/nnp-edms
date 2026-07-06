// Super Admin page: per-document-type approval policy. Controls whether each
// document type can be approved with a signature only, or whether a stamp must
// also be embedded.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDocTypePolicies, type DocTypePolicy, type DocumentType } from '@/hooks/useDocTypePolicy';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const ALL_TYPES: DocumentType[] = [
  'Learning Plan',
  'Personal Timetable',
  'Workload Allocation',
  'Scheme of Work',
  'Session Plan',
  'Class Attendance',
  'Course Outline',
];

export default function ApprovalPolicies() {
  const { currentUser, activeRole, loading } = useAuth();
  const { data: policies, isLoading } = useDocTypePolicies();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, DocTypePolicy>>({});
  const [savingType, setSavingType] = useState<string | null>(null);

  useEffect(() => {
    if (!policies) return;
    const next: Record<string, DocTypePolicy> = {};
    for (const t of ALL_TYPES) {
      const existing = policies.find((p) => p.document_type === t);
      next[t] = existing ?? {
        document_type: t,
        signature_only_allowed: false,
        stamp_required: true,
        forbid_text_only_fallback: false,
        notes: null,
        updated_at: '',
      };
    }
    setDraft(next);
  }, [policies]);

  if (loading) return null;
  if (!currentUser?.roles.includes('SUPER_ADMIN')) return <Navigate to="/" replace />;
  if (activeRole !== 'SUPER_ADMIN') {
    return (
      <div className="p-4">
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Switch to <strong>Super Admin</strong> to edit approval policies.
        </CardContent></Card>
      </div>
    );
  }

  const saveRow = async (type: DocumentType, patch: Partial<DocTypePolicy>) => {
    setSavingType(type);
    const row = { ...draft[type], ...patch };
    setDraft((d) => ({ ...d, [type]: row }));
    const payload = {
      document_type: type,
      signature_only_allowed: row.signature_only_allowed,
      stamp_required: row.stamp_required,
      notes: row.notes,
      updated_by: currentUser.id,
    };
    const { error } = await supabase
      .from('document_type_policy' as never)
      .upsert(payload as never, { onConflict: 'document_type' } as never);
    setSavingType(null);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Policy saved', description: type });
      qc.invalidateQueries({ queryKey: ['document_type_policy'] });
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Approval Policies" subtitle="Control whether each document type can be approved with just a signature." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Per document type
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {ALL_TYPES.map((t) => {
            const row = draft[t];
            if (!row) return null;
            const saving = savingType === t;
            return (
              <div key={t} className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{t}</div>
                  {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  {!row.signature_only_allowed && row.stamp_required && (
                    <Badge variant="secondary" className="text-[10px]">Stamp required</Badge>
                  )}
                  {row.signature_only_allowed && (
                    <Badge variant="outline" className="text-[10px]">Signature-only allowed</Badge>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Label className="flex items-center justify-between gap-2 border rounded p-2 text-xs cursor-pointer">
                    <div>
                      <div className="font-medium">Allow signature-only</div>
                      <div className="text-muted-foreground">Approver may skip the stamp.</div>
                    </div>
                    <Switch
                      checked={row.signature_only_allowed}
                      onCheckedChange={(v) => saveRow(t, { signature_only_allowed: v })}
                    />
                  </Label>
                  <Label className="flex items-center justify-between gap-2 border rounded p-2 text-xs cursor-pointer">
                    <div>
                      <div className="font-medium">Stamp required (default)</div>
                      <div className="text-muted-foreground">Stamp is embedded unless signature-only is allowed and chosen.</div>
                    </div>
                    <Switch
                      checked={row.stamp_required}
                      onCheckedChange={(v) => saveRow(t, { stamp_required: v })}
                    />
                  </Label>
                </div>
                <Input
                  placeholder="Notes (optional)"
                  value={row.notes ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [t]: { ...d[t], notes: e.target.value } }))}
                  onBlur={() => saveRow(t, { notes: row.notes })}
                  className="h-8 text-xs"
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
