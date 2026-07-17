// Modal to assign external verifiers to a specific verification pack.
// Lists all active verifiers whose department tags include the pack's dept
// (or verifiers with no dept tags — treated as generic reviewers).

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Loader2, Copy } from 'lucide-react';

interface Verifier {
  id: string; full_name: string; email: string;
  organisation: string | null; departments: string[] | null; active: boolean;
}
interface Assignee {
  id: string; verifier_id: string; first_opened_at: string | null;
  email_sent_at: string | null; reminder_sent_at: string | null;
}

interface Props {
  packId: string;
  packToken: string;
  department: string;
  open: boolean;
  onClose: () => void;
}

export function AssignVerifiersModal({ packId, packToken, department, open, onClose }: Props) {
  const [verifiers, setVerifiers] = useState<Verifier[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [{ data: vs }, { data: as }] = await Promise.all([
        // deno-lint-ignore no-explicit-any
        (supabase as any).from('verifiers').select('*').eq('active', true).order('full_name'),
        // deno-lint-ignore no-explicit-any
        (supabase as any).from('verification_pack_assignees').select('*').eq('pack_id', packId),
      ]);
      setLoading(false);
      setVerifiers((vs as Verifier[]) || []);
      setAssignees((as as Assignee[]) || []);
    })();
  }, [open, packId]);

  const isAssigned = (vid: string) => assignees.some((a) => a.verifier_id === vid);
  const matchesDept = (v: Verifier) =>
    !v.departments || v.departments.length === 0 || v.departments.includes(department);

  const toggle = async (vid: string, checked: boolean) => {
    setBusy(true);
    try {
      if (checked) {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase as any)
          .from('verification_pack_assignees')
          .insert({ pack_id: packId, verifier_id: vid })
          .select('*').single();
        if (error) throw error;
        setAssignees((prev) => [...prev, data as Assignee]);
      } else {
        // deno-lint-ignore no-explicit-any
        const { error } = await (supabase as any)
          .from('verification_pack_assignees')
          .delete().eq('pack_id', packId).eq('verifier_id', vid);
        if (error) throw error;
        setAssignees((prev) => prev.filter((a) => a.verifier_id !== vid));
      }
    } catch (e) {
      toast.error('Update failed', { description: (e as Error).message });
    } finally { setBusy(false); }
  };

  const copyPersonalLink = async (vid: string) => {
    const url = `${window.location.origin}/verify/pack?token=${encodeURIComponent(packToken)}&v=${vid}`;
    await navigator.clipboard.writeText(url);
    toast.success('Personal link copied');
  };

  const eligible = verifiers.filter(matchesDept);
  const other = verifiers.filter((v) => !matchesDept(v));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign verifiers — {department}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loading && eligible.length === 0 && other.length === 0 && (
            <p className="text-xs text-muted-foreground">No active verifiers. Add some in the Verifiers directory.</p>
          )}
          {eligible.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-muted-foreground">Department verifiers</p>
              {eligible.map((v) => {
                const a = assignees.find((x) => x.verifier_id === v.id);
                return (
                  <div key={v.id} className="flex items-start gap-2 border rounded p-2">
                    <Checkbox
                      checked={isAssigned(v.id)}
                      disabled={busy}
                      onCheckedChange={(c) => toggle(v.id, !!c)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{v.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {v.email}{v.organisation ? ` · ${v.organisation}` : ''}
                      </p>
                      {a?.first_opened_at && (
                        <p className="text-[10px] text-muted-foreground">
                          Opened {new Date(a.first_opened_at).toLocaleString()}
                        </p>
                      )}
                      {a?.reminder_sent_at && (
                        <p className="text-[10px] text-muted-foreground">
                          Reminder sent {new Date(a.reminder_sent_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {isAssigned(v.id) && (
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => copyPersonalLink(v.id)}>
                        <Copy className="w-3 h-3" /> Link
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {other.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-muted-foreground">Other verifiers</p>
              {other.map((v) => (
                <div key={v.id} className="flex items-start gap-2 border rounded p-2 opacity-70">
                  <Checkbox
                    checked={isAssigned(v.id)}
                    disabled={busy}
                    onCheckedChange={(c) => toggle(v.id, !!c)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{v.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{v.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
