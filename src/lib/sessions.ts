export type SessionTerm = 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC';

export const SESSION_TERMS: { key: SessionTerm; label: string; months: string }[] = [
  { key: 'JAN_APR', label: 'January – April', months: 'January – April' },
  { key: 'MAY_AUG', label: 'May – August', months: 'May – August' },
  { key: 'SEP_DEC', label: 'September – December', months: 'September – December' },
];

export function getCurrentSession(date = new Date()): { year: number; term: SessionTerm } {
  const m = date.getMonth() + 1;
  const term: SessionTerm = m <= 4 ? 'JAN_APR' : m <= 8 ? 'MAY_AUG' : 'SEP_DEC';
  return { year: date.getFullYear(), term };
}

export function sessionLabel(year: number, term: SessionTerm): string {
  const s = SESSION_TERMS.find((t) => t.key === term);
  return s ? `${s.label} ${year}` : `${term} ${year}`;
}

export function getSessionOptions(date = new Date()) {
  // Current + previous 2 sessions for backfill
  const options: { year: number; term: SessionTerm; label: string }[] = [];
  const { year, term } = getCurrentSession(date);
  const order: SessionTerm[] = ['JAN_APR', 'MAY_AUG', 'SEP_DEC'];
  let y = year;
  let idx = order.indexOf(term);
  for (let i = 0; i < 6; i++) {
    const t = order[idx];
    options.push({ year: y, term: t, label: sessionLabel(y, t) });
    idx -= 1;
    if (idx < 0) {
      idx = 2;
      y -= 1;
    }
  }
  return options;
}

export const DEPARTMENTS = [
  'Building & Civil Engineering',
  'Mechanical Engineering',
  'Electrical & Electronics Engineering',
  'Computing & Informatics',
  'Business Studies',
  'Hospitality & Institutional Management',
  'Liberal Studies',
  'Agriculture',
  'Applied Sciences',
];

export const ONE_TIME_DOC_TYPES = [
  'Learning Plan',
  'Personal Timetable',
  'Workload Allocation',
  'Scheme of Work',
] as const;

export const WEEKLY_DOC_TYPES = ['Session Plan', 'Class Attendance'] as const;
