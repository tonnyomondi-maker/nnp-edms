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
  'Computing & Informatics',
  'Building & Civil Engineering',
  'Mechanical Engineering',
  'Electrical & Electronic Engineering',
  'Agriculture & Environment',
  'Fashion & Cosmetology',
  'Business & Entrepreneurship',
  'Hospitality & Tourism',
];

export const ONE_TIME_DOC_TYPES = [
  'Learning Plan',
  'Personal Timetable',
  'Workload Allocation',
  'Course Outline',
] as const;

/**
 * Document types submitted ONCE per training session for the whole teaching
 * load (not per unit). The workload allocation form lists every unit, so a
 * single upload covers them all.
 */
export const SESSION_LEVEL_DOC_TYPES = ['Workload Allocation'] as const;

/** One-time document types expected once per UNIT. */
export const PER_UNIT_ONE_TIME_DOC_TYPES = ONE_TIME_DOC_TYPES.filter(
  (t) => !(SESSION_LEVEL_DOC_TYPES as readonly string[]).includes(t),
) as readonly string[];

export const WEEKLY_DOC_TYPES = ['Session Plan', 'Class Attendance', 'Records of Work Covered'] as const;


/** All document types the system knows about (policies, SLA targets, templates). */
export const ALL_DOC_TYPES = [...ONE_TIME_DOC_TYPES, ...WEEKLY_DOC_TYPES] as const;

/**
 * How many submissions of a weekly document type are expected per unit per session.
 * Session Plan / Class Attendance follow the teaching weeks; Records of Work Covered
 * is submitted twice a session (mid and end), tracked by week number like the others.
 */
export const WEEKLY_EXPECTED_PER_SESSION: Record<string, number> = {
  'Records of Work Covered': 2,
};


export type CourseType = 'CYCLE' | 'MODULAR';

export const COURSE_TYPES: { key: CourseType; label: string }[] = [
  { key: 'CYCLE', label: 'Cycle (Term 1–3)' },
  { key: 'MODULAR', label: 'Modular (Module 1–8)' },
];

export const MODULE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
