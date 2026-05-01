import { Tables } from '@/integrations/supabase/types';
import { StatusBadge } from './StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Calendar, ExternalLink, ShieldCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Link } from 'react-router-dom';

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
  // Prefer denormalized fields on the document itself; fall back to legacy assignment join
  const unitCode = doc.unit_code || doc.teaching_assignments?.unit_code || '';
  const className = doc.class_code || doc.teaching_assignments?.class_code || '';
  const fileLink = doc.signed_file_url || doc.file_url;

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
                {fileLink && (
                  <a
                    href={fileLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium"
                  >
                    View PDF <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                <Link
                  to={`/verify/${doc.id}`}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium"
                >
                  <ShieldCheck className="w-2.5 h-2.5" /> Verify
                </Link>
              </div>
            </div>
          </div>
          <StatusBadge status={doc.status} />
        </div>
        {actions && <div className="mt-3 flex gap-2">{actions}</div>}
      </CardContent>
    </Card>
  );
}
