import { useState } from 'react';
import { Tables } from '@/integrations/supabase/types';
import { StatusBadge } from './StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Calendar, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Link } from 'react-router-dom';
import { DocPreviewLink } from './DocPreviewLink';
import { DocStatusTimeline } from './DocStatusTimeline';
import { AuditTrailButton } from './AuditTrailButton';

type DocumentRow = Tables<'documents'> & {
  hod_signature_url?: string | null;
  hod_stamp_url?: string | null;
  dp_signature_url?: string | null;
  dp_stamp_url?: string | null;
  iqa_signature_url?: string | null;
  iqa_stamp_url?: string | null;
  signed_file_url?: string | null;
  unit_code?: string | null;
  unit_name?: string | null;
  class_code?: string | null;
  session_index?: number | null;
  term_number?: number | null;
  course_type?: string | null;
  module_number?: number | null;
};

interface DocumentCardProps {
  doc: DocumentRow & { teaching_assignments?: Tables<'teaching_assignments'> | null };
  showTrainer?: boolean;
  actions?: React.ReactNode;
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
}

function ApprovalThumb({ label, sig, stamp }: { label: string; sig?: string | null; stamp?: string | null }) {
  if (!sig && !stamp) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium">
          {label}
          {sig && <img src={sig} alt={`${label} signature`} className="w-4 h-3 object-contain" />}
          {stamp && <img src={stamp} alt={`${label} stamp`} className="w-3 h-3 object-contain" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-2">
        <p className="text-xs font-semibold">{label} approval</p>
        {sig && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Signature</p>
            <img src={sig} alt="signature" className="w-full h-12 object-contain bg-background rounded border" />
          </div>
        )}
        {stamp && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Stamp</p>
            <img src={stamp} alt="stamp" className="w-20 h-20 object-contain bg-background rounded border" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DocumentCard({ doc, showTrainer = false, actions, selectable, selected, onSelectChange }: DocumentCardProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  // Prefer denormalized fields on the document itself; fall back to legacy assignment join
  const unitCode = doc.unit_code || doc.teaching_assignments?.unit_code || '';
  const className = doc.class_code || doc.teaching_assignments?.class_code || '';
  // Always prefer the latest stamped version when available
  const fileRef = doc.signed_file_url || doc.file_url;

  return (
    <Card className="animate-slide-up">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {selectable && (
              <Checkbox
                checked={!!selected}
                onCheckedChange={(c) => onSelectChange?.(!!c)}
                className="mt-1"
                aria-label="Select document"
              />
            )}
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">{doc.document_type}</p>
              <p className="text-xs text-muted-foreground truncate">
                {unitCode}{className ? ` • ${className}` : ''}
                {doc.unit_name ? ` — ${doc.unit_name}` : ''}
                {doc.course_type === 'MODULAR' && doc.module_number ? ` • Module ${doc.module_number}` : doc.term_number ? ` • Term ${doc.term_number}` : ''}
              </p>
              {(doc.week_number || doc.session_index) && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  <span>
                    {doc.week_number ? `Week ${doc.week_number}` : ''}
                    {doc.session_index ? ` · Session ${doc.session_index}` : ''}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <ApprovalThumb label="HOD" sig={doc.hod_signature_url} stamp={doc.hod_stamp_url} />
                <ApprovalThumb label="DP" sig={doc.dp_signature_url} stamp={doc.dp_stamp_url} />
                <ApprovalThumb label="IQA" sig={doc.iqa_signature_url} stamp={doc.iqa_stamp_url} />
                <DocPreviewLink fileRef={fileRef} />
                <Link
                  to={`/verify/${doc.id}`}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium"
                >
                  <ShieldCheck className="w-2.5 h-2.5" /> Verify
                </Link>
                <AuditTrailButton documentId={doc.id} fileNameHint={unitCode || doc.file_name} />
                <button
                  type="button"
                  onClick={() => setShowTimeline((v) => !v)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium"
                  aria-expanded={showTimeline}
                >
                  Timeline {showTimeline ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                </button>
              </div>
              {doc.status === 'REJECTED' && doc.rejection_reason && (
                <p className="mt-2 text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/20">
                  <span className="font-semibold">Rejected: </span>{doc.rejection_reason}
                </p>
              )}
            </div>
          </div>
          <StatusBadge status={doc.status} />
        </div>
        {showTimeline && (
          <div className="mt-3 pt-3 border-t border-border">
            <DocStatusTimeline doc={doc} compact />
          </div>
        )}
        {actions && <div className="mt-3 flex gap-2">{actions}</div>}
      </CardContent>
    </Card>
  );
}
