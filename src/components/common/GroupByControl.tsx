import { useState, ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { sessionLabel, type SessionTerm } from '@/lib/sessions';


export type GroupByKey = 'HIERARCHY' | 'NONE' | 'SESSION' | 'STAGE' | 'DEPARTMENT' | 'TRAINER' | 'DOC_TYPE';

interface DocLike {
  id: string;
  department?: string | null;
  document_type?: string | null;
  term_number?: number | null;
  course_type?: string | null;
  module_number?: number | null;
  session_year?: number | null;
  session_term?: string | null;
  profiles?: { full_name?: string | null; pf_number?: string | null } | null;
  trainer_id?: string;
}

interface GroupByControlProps {
  value: GroupByKey;
  onChange: (v: GroupByKey) => void;
  className?: string;
}

const OPTIONS: { key: GroupByKey; label: string }[] = [
  { key: 'HIERARCHY', label: 'Recommended (nested)' },
  { key: 'NONE', label: 'No grouping' },
  { key: 'SESSION', label: 'Training session' },

  { key: 'STAGE', label: 'Term / Module' },
  { key: 'DEPARTMENT', label: 'Department' },
  { key: 'TRAINER', label: 'Trainer' },
  { key: 'DOC_TYPE', label: 'Document type' },
];


export function GroupByControl({ value, onChange, className }: GroupByControlProps) {
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Label className="text-xs text-muted-foreground whitespace-nowrap">Group by</Label>
      <Select value={value} onValueChange={(v) => onChange(v as GroupByKey)}>
        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function stageKeyOf(d: DocLike): { key: string; label: string; order: number } {
  if (d.course_type === 'MODULAR' && d.module_number) {
    return { key: `M${d.module_number}`, label: `Module ${d.module_number}`, order: 100 + d.module_number };
  }
  if (d.term_number) {
    return { key: `T${d.term_number}`, label: `Term ${d.term_number}`, order: d.term_number };
  }
  return { key: 'UNSPEC', label: 'Unspecified stage', order: 999 };
}

export function groupDocs<T extends DocLike>(
  docs: T[],
  by: GroupByKey,
): { key: string; label: string; docs: T[] }[] {
  if (by === 'NONE') return [{ key: 'ALL', label: '', docs }];
  const buckets = new Map<string, { label: string; order: number; docs: T[] }>();
  for (const d of docs) {
    let key = 'other', label = 'Other', order = 999;
    if (by === 'SESSION') {
      const y = d.session_year ?? 0;
      const t = (d.session_term as SessionTerm) || null;
      key = `${y}_${t || 'NA'}`;
      label = y && t ? sessionLabel(y, t) : 'Unspecified session';
      const termOrder = t === 'JAN_APR' ? 1 : t === 'MAY_AUG' ? 2 : t === 'SEP_DEC' ? 3 : 9;
      order = y ? -(y * 10 + (10 - termOrder)) : 9999; // newest session first
    } else if (by === 'STAGE') {
      const s = stageKeyOf(d);
      key = s.key; label = s.label; order = s.order;

    } else if (by === 'DEPARTMENT') {
      key = d.department || 'unspecified'; label = d.department || 'Unspecified department';
    } else if (by === 'TRAINER') {
      const nm = d.profiles?.full_name || 'Unknown';
      const pf = d.profiles?.pf_number ? ` (${d.profiles.pf_number})` : '';
      key = d.trainer_id || nm; label = `${nm}${pf}`;
    } else if (by === 'DOC_TYPE') {
      key = d.document_type || 'unspecified'; label = d.document_type || 'Unspecified type';
    }
    const b = buckets.get(key) || { label, order, docs: [] };
    b.docs.push(d);
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .map(([key, v]) => ({ key, label: v.label, docs: v.docs, _o: v.order }))
    .sort((a, b) => (a._o - b._o) || a.label.localeCompare(b.label))
    .map(({ _o, ...rest }) => rest);
}

interface GroupSectionProps {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}
export function GroupSection({ label, count, defaultOpen = true, children }: GroupSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (!label) return <>{children}</>;
  return (
    <div className="border rounded-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-muted/40 hover:bg-muted rounded-t-md"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>{label}</span>
        <span className="ml-auto text-muted-foreground">{count} document{count === 1 ? '' : 's'}</span>
      </button>
      {open && <div className="p-2 space-y-3">{children}</div>}
    </div>
  );
}
