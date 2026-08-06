// Visual preview of the "Document Approval & Verification Sheet" that the
// system appends to every PDF during approval. Rendered from the ACTIVE stamp
// layout so the preview always matches what stamp-document produces.

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileSignature } from 'lucide-react';
import { useActiveStampLayout } from '@/hooks/useStampLayouts';

const ROLE_LABEL: Record<string, string> = {
  HOD: 'Head of Department',
  IQA_REVIEW: 'Internal Quality Assurance',
  DP: 'Deputy Principal — Academics',
};

interface Props {
  /** Label of the document the sheet will be appended to. */
  docLabel?: string;
  trainerName?: string;
  triggerLabel?: string;
  className?: string;
  /** Render only the sheet body (used inside the bulk preview stepper). */
  inline?: boolean;
  /** Highlight the slot the current approver is about to fill. */
  highlightStage?: 'HOD' | 'IQA_REVIEW' | 'DP' | 'IQA';
}

export function ApprovalSheetBody({ docLabel, trainerName, highlightStage }: Omit<Props, 'inline' | 'triggerLabel' | 'className'>) {
  const { stages, headerTitle, label } = useActiveStampLayout();
  const total = stages.length;

  return (
    <div className="mx-auto w-full max-w-[520px] bg-background border rounded shadow-sm p-6 aspect-[1/1.414] flex flex-col">
      <p className="text-[13px] font-bold text-primary">{headerTitle}</p>
      <p className="text-[8px] text-muted-foreground mt-1">
        System-generated. Each stage below is signed in order by the responsible officer.
      </p>
      <div className="h-px bg-primary my-2" />
      {(docLabel || trainerName) && (
        <p className="text-[8px] text-muted-foreground mb-2">
          {docLabel}{docLabel && trainerName ? ' · ' : ''}{trainerName}
        </p>
      )}

      <div className="flex-1 flex flex-col gap-2">
        {stages.map((s) => {
          const active = highlightStage === s.stage;
          return (
            <div
              key={s.stage}
              className={`flex-1 border rounded-sm px-3 py-2 relative ${active ? 'border-primary bg-primary/10' : 'border-primary/40 bg-primary/5'}`}
            >
              <p className="text-[9px] font-bold text-primary">{s.title}</p>
              <div className="mt-3 h-5 border-b border-foreground/40 w-2/5" />
              <p className="text-[8px] mt-1">Name: ____________________</p>
              <p className="text-[8px]">Role: {ROLE_LABEL[s.stage] || s.stage}</p>
              <p className="text-[7px] text-muted-foreground">Date &amp; time: recorded on approval</p>
              <div
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-dashed border-muted-foreground/60 flex items-center justify-center"
                style={{ width: Math.round(s.stamp_size * 0.45), height: Math.round(s.stamp_size * 0.45) }}
              >
                <span className="text-[7px] text-muted-foreground">STAMP</span>
              </div>
              {active && <Badge className="absolute right-2 top-2 text-[8px]">Your slot</Badge>}
            </div>
          );
        })}
      </div>

      <div className="border-t mt-2 pt-1">
        <p className="text-[7px] text-muted-foreground">
          Archived by Internal Quality Assurance — recorded on archival · layout {label}
        </p>
      </div>
      <p className="sr-only">{total} signing stages</p>
    </div>
  );
}

export function ApprovalSheetPreview({ docLabel, trainerName, triggerLabel, className, highlightStage }: Props) {
  const [open, setOpen] = useState(false);
  const { label } = useActiveStampLayout();

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)}>
        <FileSignature className="w-3.5 h-3.5 mr-1" />
        {triggerLabel || 'Preview approval sheet'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approval &amp; verification sheet preview</DialogTitle>
            <DialogDescription>
              This page is appended automatically to the end of the PDF using layout <strong>{label}</strong>.
              Each approver signs their own evenly spaced slot in order — nothing is written over the content.
            </DialogDescription>
          </DialogHeader>

          <ApprovalSheetBody docLabel={docLabel} trainerName={trainerName} highlightStage={highlightStage} />

          <p className="text-xs text-muted-foreground">
            Approvers may instead place their signature directly on a page of the document. In that case this
            sheet still records the stage details for audit purposes. IQA archival is recorded in the footer.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
