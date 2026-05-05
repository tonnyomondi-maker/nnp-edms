import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

export interface QueueFilterValue {
  search: string;
  status: string;       // 'ALL' or DocumentStatus
  unitCode: string;     // 'ALL' or specific code
  documentType: string; // 'ALL' or specific type
}

export const DEFAULT_QUEUE_FILTER: QueueFilterValue = {
  search: '',
  status: 'ALL',
  unitCode: 'ALL',
  documentType: 'ALL',
};

interface QueueFilterBarProps {
  value: QueueFilterValue;
  onChange: (v: QueueFilterValue) => void;
  /** Documents to derive filter options from */
  docs: Array<Tables<'documents'>>;
  /** Whether to show the status filter (queues that already filter by status can hide it) */
  showStatus?: boolean;
}

export function QueueFilterBar({ value, onChange, docs, showStatus = true }: QueueFilterBarProps) {
  const units = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.unit_code && set.add(d.unit_code));
    return Array.from(set).sort();
  }, [docs]);
  const types = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.document_type && set.add(d.document_type));
    return Array.from(set).sort();
  }, [docs]);

  const clearable =
    value.search || value.status !== 'ALL' || value.unitCode !== 'ALL' || value.documentType !== 'ALL';

  return (
    <div className="flex flex-wrap gap-2 items-center mb-3">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          placeholder="Search unit, name, file…"
          className="pl-7 h-8 text-xs"
        />
      </div>
      {showStatus && (
        <Select value={value.status} onValueChange={(v) => onChange({ ...value, status: v })}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="HOD_APPROVED">HOD Approved</SelectItem>
            <SelectItem value="DP_APPROVED">DP Approved</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Select value={value.unitCode} onValueChange={(v) => onChange({ ...value, unitCode: v })}>
        <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Unit" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All units</SelectItem>
          {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.documentType} onValueChange={(v) => onChange({ ...value, documentType: v })}>
        <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Document type" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All types</SelectItem>
          {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
        </SelectContent>
      </Select>
      {clearable && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_QUEUE_FILTER)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

export function applyQueueFilter<T extends Tables<'documents'>>(
  docs: T[],
  f: QueueFilterValue,
): T[] {
  const q = f.search.trim().toLowerCase();
  return docs.filter((d) => {
    if (f.status !== 'ALL' && d.status !== f.status) return false;
    if (f.unitCode !== 'ALL' && d.unit_code !== f.unitCode) return false;
    if (f.documentType !== 'ALL' && d.document_type !== f.documentType) return false;
    if (q) {
      const hay = [d.unit_code, d.unit_name, d.file_name, d.class_code, d.document_type]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
