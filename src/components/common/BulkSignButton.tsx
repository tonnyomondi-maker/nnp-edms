// Bulk "Sign & approve" for HOD / DP / IQA.
// The approver positions their signature + stamp ONCE on a representative
// document; that placement is then applied to every selected document
// sequentially, continuing past individual failures.

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCachedSignedUrl, resolveSignatureUrl } from '@/hooks/useSignedDocUrl';
import { useAuth } from '@/contexts/AuthContext';
import { useBulkApproveWithPlacement, type ApprovalPlacement } from '@/hooks/useDocuments';
import type { Database } from '@/integrations/supabase/types';
import { PlacementModal } from '@/components/common/PlacementModal';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { PenLine, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { ApprovalSheetBody } from '@/components/common/ApprovalSheetPreview';

type DocumentStatus = Database['public']['Enums']['document_status'];

export interface BulkSignDoc {
  id: string;
  file_url?: string | null;
  signed_file_url?: string | null;
  file_name?: string | null;
  document_type?: string | null;
}

interface Props {
  docs: BulkSignDoc[];
  status: DocumentStatus;
  stage: 'HOD' | 'IQA_REVIEW' | 'DP' | 'IQA';
  label?: string;
  onDone?: () => void;
}

export function BulkSignButton({ docs, status, stage, label, onDone }: Props) {
  const { currentUser } = useAuth();
  const bulk = useBulkApproveWithPlacement();
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<{ index: number } | null>(null);
  const [placement, setPlacement] = useState<{ pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ succeeded: number; failed: number; failures: { docId: string; message: string }[] } | null>(null);

  const count = docs.length;
  const sheetStage = stage === 'IQA' ? 'IQA' : stage;

  const openPlacement = async () => {
    if (!currentUser || count === 0) return;
    setOpening(true);
    try {
      const { data: profile } = await supabase
        .from('profiles').select('signature_url, stamp_url, stamp_required').eq('user_id', currentUser.id).single();
      const prof = profile as unknown as { signature_url?: string; stamp_url?: string; stamp_required?: boolean } | null;
      if (!prof?.signature_url) {
        toast({ title: 'Setup required', description: 'Add a signature in Profile Settings first.', variant: 'destructive' });
        return;
      }
      if (prof.stamp_required !== false && !prof.stamp_url) {
        toast({ title: 'Stamp required', description: 'Upload a stamp in Profile Settings, or turn off "Stamp required".', variant: 'destructive' });
        return;
      }
      const sample = docs[0];
      const [pdfUrl, sigUrl, stampUrl] = await Promise.all([
        getCachedSignedUrl(sample.signed_file_url || sample.file_url || ''),
        resolveSignatureUrl(prof.signature_url),
        resolveSignatureUrl(prof.stamp_url),
      ]);
      setPreview(null);
      setPlacement({ pdfUrl, sigUrl, stampUrl });
    } catch (e) {
      toast({ title: 'Cannot open document', description: e instanceof Error ? e.message : 'Could not load PDF', variant: 'destructive' });
    } finally {
      setOpening(false);
    }
  };


  const run = async (p: ApprovalPlacement | null) => {
    setPlacement(null);
    setProgress({ done: 0, total: count });
    try {
      const res = await bulk.mutateAsync({
        docIds: docs.map((d) => d.id),
        status,
        placement: p,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(res);
      toast({
        title: 'Bulk signing complete',
        description: `${res.succeeded} signed, ${res.failed} failed.`,
        variant: res.failed > 0 ? 'destructive' : 'default',
      });
      onDone?.();
    } catch (e) {
      toast({ title: 'Bulk signing failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setProgress(null);
    }
  };

  const current = preview ? docs[preview.index] : null;

  return (
    <>
      <ActionGuardButton
        action="approve"
        size="sm"
        variant="secondary"
        className="gap-1 h-8"
        disabled={count === 0 || opening || bulk.isPending}
        onClick={() => setPreview({ index: 0 })}
        title="Preview the approval sheets, then place your signature once and apply it to every selected document"
      >
        {opening || bulk.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
        {label || 'Sign & approve selected'} ({count})
      </ActionGuardButton>

      {/* Step 1 — walk through the approval sheet that will be appended to each document */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview approval sheets ({(preview?.index ?? 0) + 1} of {count})</DialogTitle>
            <DialogDescription>
              Check each document's appended approval &amp; verification sheet before submitting them all in one go.
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs font-medium truncate">
            {current?.file_name || current?.document_type || current?.id}
          </p>
          <ApprovalSheetBody
            docLabel={current?.document_type || undefined}
            highlightStage={sheetStage}
          />

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={(preview?.index ?? 0) === 0}
                onClick={() => setPreview((p) => (p ? { index: Math.max(0, p.index - 1) } : p))}
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(preview?.index ?? 0) >= count - 1}
                onClick={() => setPreview((p) => (p ? { index: Math.min(count - 1, p.index + 1) } : p))}
              >
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Button size="sm" onClick={openPlacement} disabled={opening}>
              {opening && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Continue to signing ({count})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {placement && (
        <PlacementModal
          open={!!placement}
          onOpenChange={(o) => { if (!o) setPlacement(null); }}
          pdfUrl={placement.pdfUrl}
          signatureUrl={placement.sigUrl}
          stampUrl={placement.stampUrl}
          stage={stage}
          onConfirm={run}
        />
      )}


      <Dialog open={!!progress} onOpenChange={() => { /* blocking */ }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Signing documents…</DialogTitle>
            <DialogDescription>
              Applying your signature and stamp to {progress?.total ?? 0} document(s). Please keep this tab open.
            </DialogDescription>
          </DialogHeader>
          <Progress value={progress ? (progress.done / Math.max(progress.total, 1)) * 100 : 0} />
          <p className="text-xs text-muted-foreground text-center">{progress?.done ?? 0} of {progress?.total ?? 0}</p>
        </DialogContent>
      </Dialog>

      <Dialog open={!!result} onOpenChange={(o) => { if (!o) setResult(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk signing results</DialogTitle>
            <DialogDescription>
              {result?.succeeded ?? 0} signed successfully, {result?.failed ?? 0} failed.
            </DialogDescription>
          </DialogHeader>
          {result && result.failures.length > 0 && (
            <div className="max-h-56 overflow-y-auto space-y-2 text-xs">
              {result.failures.map((f) => {
                const doc = docs.find((d) => d.id === f.docId);
                return (
                  <div key={f.docId} className="border rounded p-2">
                    <p className="font-medium">{doc?.file_name || doc?.document_type || f.docId.slice(0, 8)}</p>
                    <p className="text-destructive">{f.message}</p>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button size="sm" onClick={() => setResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
