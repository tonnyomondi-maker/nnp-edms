import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { XCircle, Loader2 } from 'lucide-react';

const REASON_CATEGORIES = [
  'Missing signature',
  'Missing stamp',
  'CBET compliance issue',
  'Wrong format / template',
  'Incomplete content',
  'Wrong document type',
  'Other',
];

interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docLabel?: string;
  stage: 'HOD' | 'DP' | 'IQA';
  onConfirm: (reason: string) => Promise<void> | void;
  isPending?: boolean;
}

export function RejectDialog({ open, onOpenChange, docLabel, stage, onConfirm, isPending }: RejectDialogProps) {
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  const toggle = (c: string) => {
    setCategories((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const composed = [Array.from(categories).join(', '), notes.trim()].filter(Boolean).join(' — ');
  const valid = composed.length >= 5;

  const handleConfirm = async () => {
    if (!valid) return;
    await onConfirm(composed);
    setCategories(new Set());
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isPending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><XCircle className="w-4 h-4 text-destructive" /> Reject document</DialogTitle>
          <DialogDescription>
            Your comment is sent back to the trainer with the rejection so they can edit and resubmit.
            {docLabel && <> Document: <strong>{docLabel}</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Category (optional — tap any that apply)</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {REASON_CATEGORIES.map((c) => {
                const active = categories.has(c);
                return (
                  <Badge
                    key={c}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer text-[11px] px-2 py-1"
                    onClick={() => toggle(c)}
                  >
                    {c}
                  </Badge>
                );
              })}
            </div>
          </div>
          <div>
            <Label htmlFor="reject-notes" className="text-xs">Comment for the trainer *</Label>
            <Textarea
              id="reject-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain what needs to be corrected (min 5 chars total, including tags above)"
              rows={4}
              className="mt-1.5"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Rejecting as <strong>{stage}</strong>. The trainer will see this text on their rejected card and can resubmit an updated version.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!valid || isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Send rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
