import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// 'ALL' | 'T1'..'T3' | 'M1'..'M8'
export type TermFilterValue = 'ALL' | 'T1' | 'T2' | 'T3' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';

type DocLike = { term_number?: number | null; course_type?: string | null; module_number?: number | null };

interface TermFilterProps {
  value: TermFilterValue;
  onChange: (v: TermFilterValue) => void;
  counts?: Record<TermFilterValue, number>;
  className?: string;
}

const TERM_KEYS: TermFilterValue[] = ['T1', 'T2', 'T3'];
const MODULE_KEYS: TermFilterValue[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'];

function label(v: TermFilterValue): string {
  if (v === 'ALL') return 'All stages';
  if (v.startsWith('T')) return `Term ${v.slice(1)}`;
  return `Module ${v.slice(1)}`;
}

export function TermFilter({ value, onChange, counts, className }: TermFilterProps) {
  const fmt = (k: TermFilterValue) => `${label(k)}${counts ? ` (${counts[k] ?? 0})` : ''}`;
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Label className="text-xs text-muted-foreground whitespace-nowrap">Filter by stage</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TermFilterValue)}>
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{fmt('ALL')}</SelectItem>
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase">Cycle Terms</SelectLabel>
            {TERM_KEYS.map((k) => <SelectItem key={k} value={k}>{fmt(k)}</SelectItem>)}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase">Modules</SelectLabel>
            {MODULE_KEYS.map((k) => <SelectItem key={k} value={k}>{fmt(k)}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Pick the most-frequent stage; fall back to 'ALL'. */
export function pickDefaultTerm(docs: DocLike[]): TermFilterValue {
  const counts = termCounts(docs);
  const keys: TermFilterValue[] = [...TERM_KEYS, ...MODULE_KEYS];
  let best: TermFilterValue = 'ALL';
  let bestN = 0;
  keys.forEach((k) => { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return best;
}

export function filterByTerm<T extends DocLike>(docs: T[], value: TermFilterValue): T[] {
  if (value === 'ALL') return docs;
  if (value.startsWith('T')) {
    const n = Number(value.slice(1));
    return docs.filter((d) => d.course_type !== 'MODULAR' && d.term_number === n);
  }
  const n = Number(value.slice(1));
  return docs.filter((d) => d.course_type === 'MODULAR' && d.module_number === n);
}

export function termCounts<T extends DocLike>(docs: T[]): Record<TermFilterValue, number> {
  const c: Record<TermFilterValue, number> = {
    ALL: docs.length,
    T1: 0, T2: 0, T3: 0,
    M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0, M7: 0, M8: 0,
  };
  docs.forEach((d) => {
    if (d.course_type === 'MODULAR' && d.module_number) {
      const k = `M${d.module_number}` as TermFilterValue;
      if (k in c) c[k]++;
    } else if (d.term_number) {
      const k = `T${d.term_number}` as TermFilterValue;
      if (k in c) c[k]++;
    }
  });
  return c;
}
