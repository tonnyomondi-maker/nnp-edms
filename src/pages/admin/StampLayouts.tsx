// Super Admin editor for approval-sheet stamp/signature layout versions.
// The active version drives both the appended PDF page and the in-app preview.

import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { ApprovalSheetBody } from '@/components/common/ApprovalSheetPreview';
import {
  useStampLayouts, useSaveStampLayout, useActivateStampLayout, useDeleteStampLayout,
  DEFAULT_STAGES, type StampLayout, type StampStageLayout,
} from '@/hooks/useStampLayouts';
import { CheckCircle2, Copy, Loader2, Plus, Save, Trash2 } from 'lucide-react';

const STAGE_HINT: Record<string, string> = {
  HOD: 'Head of Department',
  IQA_REVIEW: 'Internal Quality Assurance',
  DP: 'Deputy Principal — Academics',
};

interface Draft {
  id?: string;
  name: string;
  version: number;
  header_title: string;
  stages: StampStageLayout[];
}

const blankDraft = (): Draft => ({
  name: '',
  version: 1,
  header_title: 'DOCUMENT APPROVAL & VERIFICATION SHEET',
  stages: DEFAULT_STAGES.map((s) => ({ ...s })),
});

export default function StampLayouts() {
  const { currentUser, loading } = useAuth();
  const { data: layouts = [], isLoading } = useStampLayouts();
  const save = useSaveStampLayout();
  const activate = useActivateStampLayout();
  const del = useDeleteStampLayout();

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && layouts.length > 0) {
      const active = layouts.find((l) => l.is_active) || layouts[0];
      setSelectedId(active.id);
    }
  }, [layouts, selectedId]);

  useEffect(() => {
    const found = layouts.find((l) => l.id === selectedId);
    if (found) {
      setDraft({
        id: found.id,
        name: found.name,
        version: found.version,
        header_title: found.header_title,
        stages: (found.stages?.length ? found.stages : DEFAULT_STAGES).map((s) => ({ ...s })),
      });
    }
  }, [selectedId, layouts]);

  const sortedStages = useMemo(
    () => draft.stages.slice().sort((a, b) => a.order - b.order),
    [draft.stages],
  );

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!currentUser?.roles.includes('SUPER_ADMIN')) return <Navigate to="/" replace />;

  const setStage = (stage: string, patch: Partial<StampStageLayout>) =>
    setDraft((d) => ({ ...d, stages: d.stages.map((s) => (s.stage === stage ? { ...s, ...patch } : s)) }));

  const isActive = (l: StampLayout) => l.is_active;

  const doSave = async () => {
    if (!draft.name.trim()) {
      toast({ title: 'Name required', description: 'Give this layout version a name.', variant: 'destructive' });
      return;
    }
    try {
      const saved = await save.mutateAsync({
        id: draft.id,
        name: draft.name.trim(),
        version: draft.version,
        header_title: draft.header_title.trim() || 'DOCUMENT APPROVAL & VERIFICATION SHEET',
        stages: draft.stages,
        is_active: layouts.find((l) => l.id === draft.id)?.is_active ?? false,
      });
      setSelectedId(saved.id);
      toast({ title: 'Layout saved' });
    } catch (e) {
      toast({ title: 'Could not save layout', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const duplicate = () => {
    setSelectedId(null);
    setDraft((d) => ({ ...d, id: undefined, name: `${d.name || 'Layout'} (copy)`, version: d.version + 1 }));
  };

  const doActivate = async (id: string) => {
    try {
      await activate.mutateAsync(id);
      toast({ title: 'Layout activated', description: 'New approvals will use this version.' });
    } catch (e) {
      toast({ title: 'Could not activate', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const doDelete = async (l: StampLayout) => {
    if (l.is_active) {
      toast({ title: 'Cannot delete', description: 'Activate another version first.', variant: 'destructive' });
      return;
    }
    if (!window.confirm(`Delete layout "${l.name} v${l.version}"?`)) return;
    try {
      await del.mutateAsync(l.id);
      if (selectedId === l.id) { setSelectedId(null); setDraft(blankDraft()); }
      toast({ title: 'Layout deleted' });
    } catch (e) {
      toast({ title: 'Could not delete', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Stamp layouts"
        subtitle="Design the approval & verification sheet appended to every PDF, and choose which version is live."
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold">Saved versions</p>
            <Button size="sm" variant="outline" onClick={() => { setSelectedId(null); setDraft(blankDraft()); }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New version
            </Button>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : layouts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No saved versions yet — the built-in default is used.</p>
          ) : (
            <div className="space-y-1">
              {layouts.map((l) => (
                <div
                  key={l.id}
                  className={`flex items-center gap-2 border rounded p-2 ${selectedId === l.id ? 'border-primary bg-primary/5' : ''}`}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(l.id)}>
                    <p className="text-xs font-semibold truncate">{l.name} v{l.version}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{l.header_title}</p>
                  </button>
                  {isActive(l) ? (
                    <Badge className="text-[10px]">Active</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => doActivate(l.id)} disabled={activate.isPending}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Activate
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => doDelete(l)} aria-label="Delete layout">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-sm">Version name</Label>
                <Input className="mt-1.5" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Standard 2026" />
              </div>
              <div>
                <Label className="text-sm">Version no.</Label>
                <Input className="mt-1.5" type="number" min={1} value={draft.version}
                  onChange={(e) => setDraft({ ...draft, version: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
            </div>
            <div>
              <Label className="text-sm">Header title</Label>
              <Input className="mt-1.5" value={draft.header_title} onChange={(e) => setDraft({ ...draft, header_title: e.target.value })} />
            </div>

            <div className="space-y-3 pt-1">
              {sortedStages.map((s) => (
                <div key={s.stage} className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">{STAGE_HINT[s.stage] || s.stage}</p>
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Order</Label>
                      <Input className="h-7 w-14 text-xs" type="number" min={1} max={3} value={s.order}
                        onChange={(e) => setStage(s.stage, { order: Math.max(1, Number(e.target.value) || 1) })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[11px]">Slot title</Label>
                    <Input className="mt-1 h-8 text-xs" value={s.title} onChange={(e) => setStage(s.stage, { title: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {([
                      ['slot_height', 'Slot height'],
                      ['sig_w', 'Signature W'],
                      ['sig_h', 'Signature H'],
                      ['stamp_size', 'Stamp size'],
                      ['title_size', 'Title font'],
                    ] as const).map(([key, label]) => (
                      <div key={key}>
                        <Label className="text-[10px] text-muted-foreground">{label}</Label>
                        <Input className="mt-1 h-8 text-xs" type="number" min={1} value={s[key]}
                          onChange={(e) => setStage(s.stage, { [key]: Math.max(1, Number(e.target.value) || 1) } as Partial<StampStageLayout>)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={doSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save version
              </Button>
              <Button size="sm" variant="outline" onClick={duplicate}>
                <Copy className="w-4 h-4 mr-1" /> Duplicate as new
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sizes are in PDF points. Saving does not change live approvals until you activate the version.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold mb-2">Live preview (active layout)</p>
            <ApprovalSheetBody docLabel="Sample document" trainerName="Sample Trainer" />
            <p className="text-[11px] text-muted-foreground mt-2">
              The preview reflects the currently <strong>active</strong> layout. Activate a version to see your edits here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
