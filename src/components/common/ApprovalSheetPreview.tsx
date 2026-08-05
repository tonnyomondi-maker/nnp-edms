// Visual preview of the "Document Approval & Verification Sheet" that the
// system appends to every PDF during approval. Mirrors the layout produced by
// the stamp-document edge function (A4 portrait, four ordered stage slots) so
// trainers can confirm the sheet looks right before submitting.

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileSignature } from 'lucide-react';

const STAGES = [
  { order: 1, title: '1. VERIFIED BY HEAD OF DEPARTMENT', role: 'Head of Department' },
  { order: 2, title: '2. REVIEWED BY INTERNAL QUALITY ASSURANCE', role: 'IQA Review' },
  { order: 3, title: '3. APPROVED BY DEPUTY PRINCIPAL — ACADEMICS', role: 'DP Academics' },
  { order: 4, title: '4. ARCHIVED BY INTERNAL QUALITY ASSURANCE', role: 'IQA Archival' },
];

interface Props {
  /** Label of the document the sheet will be appended to. */
  docLabel?: string;
  trainerName?: string;
  triggerLabel?: string;
  className?: string;
}

export function ApprovalSheetPreview({ docLabel, trainerName, triggerLabel, className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        <FileSignature className="w-3.5 h-3.5 mr-1" />
        {triggerLabel || 'Preview approval sheet'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approval &amp; verification sheet preview</DialogTitle>
            <DialogDescription>
              This page is appended automatically to the end of your PDF. Each approver signs their
              own slot in order — nothing is written over your content.
            </DialogDescription>
          </DialogHeader>

          {/* A4-proportioned sheet mock */}
          <div className="mx-auto w-full max-w-[520px] bg-background border rounded shadow-sm p-6 aspect-[1/1.414]">
            <p className="text-[13px] font-bold text-primary">DOCUMENT APPROVAL &amp; VERIFICATION SHEET</p>
            <p className="text-[8px] text-muted-foreground mt-1">
              System-generated. Each stage below is signed in order by the responsible officer.
            </p>
            <div className="h-px bg-primary my-2" />
            {(docLabel || trainerName) && (
              <p className="text-[8px] text-muted-foreground mb-2">
                {docLabel}{docLabel && trainerName ? ' · ' : ''}{trainerName}
              </p>
            )}

            <div className="space-y-2">
              {STAGES.map((s) => (
                <div
                  key={s.order}
                  className="border border-primary/50 bg-primary/5 rounded-sm px-3 py-2 relative"
                >
                  <p className="text-[9px] font-bold text-primary">{s.title}</p>
                  <div className="mt-3 h-5 border-b border-foreground/40 w-2/5" />
                  <p className="text-[8px] mt-1">Name: ____________________</p>
                  <p className="text-[8px]">Role: {s.role}</p>
                  <p className="text-[7px] text-muted-foreground">Date &amp; time: recorded on approval</p>
                  <div className="absolute right-3 bottom-2 w-12 h-12 rounded-full border border-dashed border-muted-foreground/60 flex items-center justify-center">
                    <span className="text-[7px] text-muted-foreground">STAMP</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Approvers may instead place their signature directly on a page of your document. In that
            case this sheet still records the stage details for audit purposes.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
