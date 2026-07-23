import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docId: string;
  fromStage: 'DP' | 'IQA';
}

export function ReturnStageDialog({ open, onOpenChange, docId, fromStage }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const targetLabel = fromStage === 'DP' ? 'HOD' : 'DP Academics';
  const targetStatus = fromStage === 'DP' ? 'SUBMITTED' : 'HOD_APPROVED';

  const submit = async () => {
    if (note.trim().length < 5) {
      toast({ title: 'Note too short', description: 'Add at least 5 characters.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from('documents')
        .update({
          status: targetStatus,
          return_note: note.trim(),
          returned_at: new Date().toISOString(),
          returned_by: user?.id ?? null,
        } as never)
        .eq('id', docId);
      if (error) throw error;
      toast({ title: `Returned to ${targetLabel}` });
      qc.invalidateQueries({ queryKey: ['documents'] });
      onOpenChange(false);
      setNote('');
    } catch (e) {
      toast({ title: 'Return failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Return to {targetLabel}</DialogTitle>
          <DialogDescription>
            Send this document back to {targetLabel} for a minor fix instead of rejecting to the trainer. Your note is visible in the timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Note *</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="e.g. Missing week 5 session plan — please confirm before re-approving." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
