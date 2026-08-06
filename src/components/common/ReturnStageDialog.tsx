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
import { notifyDocumentEvent, STAGE_LABEL, STAGE_ORDER, CLIENT_STAMP_VERSION } from '@/lib/notify';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docId: string;
  fromStage: 'IQA_REVIEW' | 'DP' | 'IQA';
}

export function ReturnStageDialog({ open, onOpenChange, docId, fromStage }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Workflow: Trainer → HOD verify → IQA review → DP approve → IQA archive.
  const targetLabel = fromStage === 'IQA_REVIEW' ? 'HOD' : fromStage === 'DP' ? 'IQA review' : 'DP Academics';
  const targetStatus = fromStage === 'IQA_REVIEW' ? 'SUBMITTED' : fromStage === 'DP' ? 'HOD_APPROVED' : 'IQA_REVIEWED';


  const submit = async () => {
    if (note.trim().length < 5) {
      toast({ title: 'Note too short', description: 'Add at least 5 characters.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { data: prev } = await supabase
        .from('documents').select('trainer_id, document_type, file_name').eq('id', docId).single();
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
      const p = prev as { trainer_id?: string; document_type?: string; file_name?: string } | null;
      if (p?.trainer_id) {
        await notifyDocumentEvent({
          userId: p.trainer_id,
          documentId: docId,
          kind: 'RETURNED',
          stage: fromStage,
          title: `${p.document_type || 'Document'} returned by ${STAGE_LABEL[fromStage]} to ${targetLabel}`,
          message: `${p.file_name || 'Your document'} moved back to stage ${STAGE_ORDER[fromStage] ?? '-'} handling. Stamp version ${CLIENT_STAMP_VERSION}.`,
          note: note.trim(),
        });
      }
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
