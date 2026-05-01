import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export type TermFilterValue = 'ALL' | '1' | '2' | '3';

interface TermFilterProps {
  value: TermFilterValue;
  onChange: (v: TermFilterValue) => void;
  counts?: Record<TermFilterValue, number>;
  className?: string;
}

export function TermFilter({ value, onChange, counts, className }: TermFilterProps) {
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Label className="text-xs text-muted-foreground whitespace-nowrap">Filter by term</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TermFilterValue)}>
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All terms{counts ? ` (${counts.ALL})` : ''}</SelectItem>
          <SelectItem value="1">Term 1{counts ? ` (${counts['1']})` : ''}</SelectItem>
          <SelectItem value="2">Term 2{counts ? ` (${counts['2']})` : ''}</SelectItem>
          <SelectItem value="3">Term 3{counts ? ` (${counts['3']})` : ''}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Pick a smart default term: the most-frequent term among the docs.
 * Falls back to 'ALL' when no docs have a term_number.
 */
export function pickDefaultTerm(docs: Array<{ term_number?: number | null }>): TermFilterValue {
  const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0 };
  docs.forEach((d) => {
    const t = d.term_number;
    if (t === 1 || t === 2 || t === 3) counts[String(t)]++;
  });
  const top = (['1', '2', '3'] as const).reduce<{ k: TermFilterValue; n: number }>(
    (acc, k) => (counts[k] > acc.n ? { k, n: counts[k] } : acc),
    { k: 'ALL', n: 0 },
  );
  return top.k;
}

export function filterByTerm<T extends { term_number?: number | null }>(
  docs: T[],
  value: TermFilterValue,
): T[] {
  if (value === 'ALL') return docs;
  const n = Number(value);
  return docs.filter((d) => d.term_number === n);
}

export function termCounts<T extends { term_number?: number | null }>(
  docs: T[],
): Record<TermFilterValue, number> {
  const c: Record<TermFilterValue, number> = { ALL: docs.length, '1': 0, '2': 0, '3': 0 };
  docs.forEach((d) => {
    if (d.term_number === 1) c['1']++;
    else if (d.term_number === 2) c['2']++;
    else if (d.term_number === 3) c['3']++;
  });
  return c;
}
