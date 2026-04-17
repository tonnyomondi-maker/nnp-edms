import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type DocumentStatus = Database['public']['Enums']['document_status'];

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  isAllSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  approveStatus: DocumentStatus;
  approveLabel?: string;
  showReject?: boolean;
  onBulkAction: (status: DocumentStatus, rejectionReason?: string) => Promise<void> | void;
  isPending?: boolean;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  isAllSelected,
  onToggleAll,
  onClear,
  approveStatus,
  approveLabel = 'Approve',
  showReject = true,
  onBulkAction,
  isPending,
}: BulkActionBarProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onToggleAll}
            disabled={totalCount === 0}
            className="font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
          >
            {isAllSelected && totalCount > 0 ? 'Clear all' : `Select all (${totalCount})`}
          </button>
          {selectedCount > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-foreground font-semibold">{selectedCount} selected</span>
              <button onClick={onClear} className="text-muted-foreground hover:text-foreground underline">
                Clear
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showReject && (
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedCount === 0 || isPending}
              onClick={() => setRejectOpen(true)}
              className="gap-1 h-8"
            >
              <XCircle className="w-3.5 h-3.5" /> Reject
            </Button>
          )}
          <Button
            size="sm"
            disabled={selectedCount === 0 || isPending}
            onClick={() => onBulkAction(approveStatus)}
            className="gap-1 h-8"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {approveLabel}
          </Button>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selectedCount} document{selectedCount === 1 ? '' : 's'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (shared across selected)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what needs revision…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || isPending}
              onClick={async () => {
                await onBulkAction('REJECTED', reason.trim());
                setRejectOpen(false);
                setReason('');
              }}
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reject all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
