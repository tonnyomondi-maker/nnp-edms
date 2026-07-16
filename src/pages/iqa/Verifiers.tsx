// IQA / Super Admin — CRUD directory of external verifiers.
// Tagged per-department so we can filter them when assigning to packs.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { DEPARTMENTS } from '@/lib/sessions';
import { Loader2, UserPlus, Trash2, Edit2, X, Save } from 'lucide-react';

interface Verifier {
  id: string; full_name: string; email: string;
  organisation: string | null; phone: string | null;
  departments: string[]; notes: string | null; active: boolean;
}

const blank: Omit<Verifier, 'id'> = {
  full_name: '', email: '', organisation: '', phone: '',
  departments: [], notes: '', active: true,
};

export default function Verifiers() {
  const { currentUser, activeRole, loading } = useAuth();
  const [rows, setRows] = useState<Verifier[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Omit<Verifier, 'id'>>(blank);
  const [busy, setBusy] = useState(false);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');

  const load = async () => {
    setLoadingRows(true);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any).from('verifiers').select('*').order('full_name');
    setLoadingRows(false);
    if (error) { toast.error('Load failed', { description: error.message }); return; }
    setRows((data as Verifier[]) || []);
  };

  useEffect(() => { if (canUse) load(); }, [canUse]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!currentUser.roles.includes('IQA') && !currentUser.roles.includes('SUPER_ADMIN')) {
    return <Navigate to="/" replace />;
  }
  if (!canUse) {
    return <div className="p-4"><Card><CardContent className="p-4 text-sm text-muted-foreground">
      Switch to <strong>IQA</strong> or <strong>Super Admin</strong> to manage verifiers.
    </CardContent></Card></div>;
  }

  const start = (v?: Verifier) => {
    setEditing(v ? v.id : 'new');
    setDraft(v ? { ...v } : { ...blank });
  };
  const cancel = () => { setEditing(null); setDraft(blank); };

  const save = async () => {
    if (!draft.full_name.trim() || !draft.email.trim()) {
      toast.error('Name and email required');
      return;
    }
    setBusy(true);
    const payload = {
      full_name: draft.full_name.trim(),
      email: draft.email.trim().toLowerCase(),
      organisation: draft.organisation || null,
      phone: draft.phone || null,
      departments: draft.departments,
      notes: draft.notes || null,
      active: draft.active,
    };
    try {
      if (editing === 'new') {
        // deno-lint-ignore no-explicit-any
        const { error } = await (supabase as any).from('verifiers').insert(payload);
        if (error) throw error;
        toast.success('Verifier added');
      } else if (editing) {
        // deno-lint-ignore no-explicit-any
        const { error } = await (supabase as any).from('verifiers').update(payload).eq('id', editing);
        if (error) throw error;
        toast.success('Verifier updated');
      }
      cancel();
      load();
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this verifier? Existing assignments will be dropped.')) return;
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from('verifiers').delete().eq('id', id);
    if (error) { toast.error('Delete failed', { description: error.message }); return; }
    toast.success('Removed');
    load();
  };

  const toggleDept = (d: string) => {
    setDraft((prev) => ({
      ...prev,
      departments: prev.departments.includes(d)
        ? prev.departments.filter((x) => x !== d)
        : [...prev.departments, d],
    }));
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Verifiers" subtitle="External auditors who receive verification packs." />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Directory</CardTitle>
          {editing !== 'new' && (
            <Button size="sm" onClick={() => start()} className="gap-1">
              <UserPlus className="w-4 h-4" /> Add verifier
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {editing === 'new' && <EditForm draft={draft} setDraft={setDraft} save={save} cancel={cancel} busy={busy} toggleDept={toggleDept} />}
          {loadingRows && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loadingRows && rows.length === 0 && editing !== 'new' && (
            <p className="text-xs text-muted-foreground">No verifiers yet.</p>
          )}
          {rows.map((v) => (
            editing === v.id ? (
              <EditForm key={v.id} draft={draft} setDraft={setDraft} save={save} cancel={cancel} busy={busy} toggleDept={toggleDept} />
            ) : (
              <div key={v.id} className="border rounded p-3 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{v.full_name} {!v.active && <Badge variant="outline" className="ml-1">inactive</Badge>}</p>
                    <p className="text-muted-foreground">{v.email}{v.organisation ? ` · ${v.organisation}` : ''}{v.phone ? ` · ${v.phone}` : ''}</p>
                    {v.departments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.departments.map((d) => <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>)}
                      </div>
                    )}
                    {v.notes && <p className="text-muted-foreground mt-1 italic">{v.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => start(v)}><Edit2 className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(v.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              </div>
            )
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function EditForm({ draft, setDraft, save, cancel, busy, toggleDept }: {
  draft: Omit<Verifier, 'id'>;
  setDraft: (v: Omit<Verifier, 'id'>) => void;
  save: () => void; cancel: () => void; busy: boolean;
  toggleDept: (d: string) => void;
}) {
  return (
    <div className="border rounded p-3 space-y-2 bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Full name</Label><Input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Email</Label><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Organisation</Label><Input value={draft.organisation ?? ''} onChange={(e) => setDraft({ ...draft, organisation: e.target.value })} className="h-8" /></div>
        <div><Label className="text-xs">Phone</Label><Input value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="h-8" /></div>
      </div>
      <div>
        <Label className="text-xs">Departments</Label>
        <div className="grid grid-cols-2 gap-1 mt-1">
          {DEPARTMENTS.map((d) => (
            <label key={d} className="flex items-center gap-2 text-xs">
              <Checkbox checked={draft.departments.includes(d)} onCheckedChange={() => toggleDept(d)} /> {d}
            </label>
          ))}
        </div>
      </div>
      <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
      <div className="flex items-center gap-2 text-xs">
        <Switch checked={draft.active} onCheckedChange={(c) => setDraft({ ...draft, active: c })} /> Active
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={cancel} disabled={busy}><X className="w-3 h-3 mr-1" /> Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save</Button>
      </div>
    </div>
  );
}
