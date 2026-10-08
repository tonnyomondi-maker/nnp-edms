// Trainer asks their HOD to remove a unit registered by mistake.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Clock, Loader2, Trash2 } from 'lucide-react';

export function RequestUnitRemovalButton({ configId, unitCode }: { configId: string; unitCode: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: pending } = useQuery({
    queryKey: ['unit-deletion-requests', 'config', configId],
    queryFn: async () => {
      const { data } = await supabase.from('unit_deletion_requests').select('id')
        .eq('config_id', configId).eq('status', 'PENDING').maybeSingle();
      return data;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['unit-deletion-requests'] });

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('request_unit_deletion', { _config_id: configId, _reason: reason });
    setBusy(false);
    if (error) { toast({ title: 'Could not send request', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Request sent', description: 'Your HOD will review the removal of this unit.' });
    setOpen(false); setReason(''); refresh();
  };

  const cancel = async () => {
    if (!pending) return;
    const { error } = await supabase.rpc('cancel_unit_deletion_request', { _request_id: pending.id });
    if (error) { toast({ title: 'Could not cancel', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Request cancelled' }); refresh();
  };

  if (pending) {
    return (
      <Button size="sm" variant="outline" className="h-10 sm:h-9" onClick={cancel}>
        <Clock className="w-4 h-4 mr-1" /> Removal requested — cancel
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="h-10 sm:h-9 text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="w-4 h-4 mr-1" /> Request removal
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask your HOD to remove {unitCode}?</DialogTitle>
            <DialogDescription>Use this only if the unit was registered by mistake. Documents you already submitted are kept.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. I don't teach this unit this term)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={submit}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
