// Shared reporting aggregation.
//
// KEY RULE: coverage is counted per (unit, document type) pair — never by the
// number of uploaded rows. A Learning Plan rejected three times and corrected
// is still ONE covered document type, not four.

import { PER_UNIT_ONE_TIME_DOC_TYPES, SESSION_LEVEL_DOC_TYPES } from '@/lib/sessions';

export interface ReportDoc {
  id: string;
  trainer_id: string;
  department: string;
  unit_code: string | null;
  document_type: string;
  status: string;
  version?: number | null;
  rejection_count?: number | null;
  submitted_at: string;
  hod_approved_at: string | null;
  iqa_reviewed_at?: string | null;
  dp_approved_at: string | null;
  archived_at: string | null;
}

export interface ReportConfig {
  trainer_id: string;
  department: string;
  unit_code: string;
}

export interface ReportProfile {
  user_id: string;
  full_name: string;
  department: string | null;
}

/** Statuses that mean "this document type is currently on file". */
export const LIVE_STATUSES = ['SUBMITTED', 'HOD_APPROVED', 'IQA_REVIEWED', 'DP_APPROVED', 'ARCHIVED', 'EXPORTED'];

export const isLive = (status: string) => LIVE_STATUSES.includes(status);

const key = (unit: string, type: string) => `${unit}::${type}`;

export interface TrainerCoverage {
  id: string;
  name: string;
  department: string;
  units: number;
  expected: number;
  covered: number;
  pct: number;
  pending: number;
  approved: number;
  rejectedTypes: number;
  uploads: number;
  /** Session-level workload allocation (one per session, not per unit). */
  workloadOnFile: boolean;
}

export interface MissingRow {
  trainerId: string;
  trainer: string;
  department: string;
  unit: string;
  missing: string[];
}

export interface DeptCoverage {
  dept: string;
  trainers: number;
  units: number;
  expected: number;
  covered: number;
  pct: number;
}

interface Input {
  docs: ReportDoc[];
  configs: ReportConfig[];
  profiles: ReportProfile[];
}

/** Distinct (unit, type) pairs that currently have a live document. */
export function coveredPairs(docs: ReportDoc[]): Set<string> {
  const set = new Set<string>();
  docs.forEach((d) => {
    if (!d.unit_code) return;
    if (!isLive(d.status)) return;
    set.add(key(d.unit_code, d.document_type));
  });
  return set;
}

export function trainerCoverage({ docs, configs, profiles }: Input): TrainerCoverage[] {
  const byTrainer = new Map<string, TrainerCoverage>();
  const trainerIds = new Set<string>([...configs.map((c) => c.trainer_id), ...docs.map((d) => d.trainer_id)]);

  trainerIds.forEach((tid) => {
    const profile = profiles.find((p) => p.user_id === tid);
    const tConfigs = configs.filter((c) => c.trainer_id === tid);
    const tDocs = docs.filter((d) => d.trainer_id === tid);
    const units = Array.from(new Set(tConfigs.map((c) => c.unit_code)));
    const covered = coveredPairs(tDocs);

    let coveredCount = 0;
    units.forEach((u) => {
      PER_UNIT_ONE_TIME_DOC_TYPES.forEach((t) => {
        if (covered.has(key(u, t))) coveredCount += 1;
      });
    });

    // Session-level types (workload allocation) count once per trainer per
    // session — one upload covers every unit taught that session.
    const sessionCovered = SESSION_LEVEL_DOC_TYPES.filter((t) =>
      tDocs.some((d) => d.document_type === t && isLive(d.status)),
    ).length;
    const sessionExpected = units.length > 0 ? SESSION_LEVEL_DOC_TYPES.length : 0;
    coveredCount += Math.min(sessionCovered, sessionExpected);

    const expected = units.length * PER_UNIT_ONE_TIME_DOC_TYPES.length + sessionExpected;
    // Rejected types = distinct (unit,type) currently sitting rejected.
    const rejected = new Set(
      tDocs.filter((d) => d.status === 'REJECTED' && d.unit_code).map((d) => key(d.unit_code as string, d.document_type)),
    );

    byTrainer.set(tid, {
      id: tid,
      name: profile?.full_name || 'Unknown trainer',
      department: profile?.department || tConfigs[0]?.department || tDocs[0]?.department || '—',
      units: units.length,
      expected,
      covered: coveredCount,
      pct: expected > 0 ? Math.round((coveredCount / expected) * 100) : 0,
      pending: new Set(tDocs.filter((d) => d.status === 'SUBMITTED' && d.unit_code).map((d) => key(d.unit_code as string, d.document_type))).size,
      approved: new Set(
        tDocs.filter((d) => ['DP_APPROVED', 'ARCHIVED', 'EXPORTED'].includes(d.status) && d.unit_code)
          .map((d) => key(d.unit_code as string, d.document_type)),
      ).size,
      rejectedTypes: rejected.size,
      uploads: tDocs.length,
      workloadOnFile: sessionCovered > 0,
    });
  });


  return Array.from(byTrainer.values())
    .filter((r) => r.units > 0 || r.uploads > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function missingByUnit({ docs, configs, profiles }: Input): MissingRow[] {
  const rows: MissingRow[] = [];
  configs.forEach((c) => {
    const tDocs = docs.filter((d) => d.trainer_id === c.trainer_id);
    const covered = coveredPairs(tDocs);
    const missing = PER_UNIT_ONE_TIME_DOC_TYPES.filter((t) => !covered.has(key(c.unit_code, t)));
    if (missing.length === 0) return;
    rows.push({
      trainerId: c.trainer_id,
      trainer: profiles.find((p) => p.user_id === c.trainer_id)?.full_name || 'Unknown trainer',
      department: c.department,
      unit: c.unit_code,
      missing: [...missing],
    });
  });
  return rows.sort((a, b) => a.trainer.localeCompare(b.trainer) || a.unit.localeCompare(b.unit));
}

export function departmentCoverage({ docs, configs, profiles }: Input, departments: string[]): DeptCoverage[] {
  return departments.map((dept) => {
    const dConfigs = configs.filter((c) => c.department === dept);
    const trainerIds = Array.from(new Set(dConfigs.map((c) => c.trainer_id)));
    const dDocs = docs.filter((d) => d.department === dept);

    let coveredCount = 0;
    trainerIds.forEach((tid) => {
      const tDocs = dDocs.filter((d) => d.trainer_id === tid);
      const covered = coveredPairs(tDocs);
      dConfigs.filter((c) => c.trainer_id === tid).forEach((c) => {
        PER_UNIT_ONE_TIME_DOC_TYPES.forEach((t) => {
          if (covered.has(key(c.unit_code, t))) coveredCount += 1;
        });
      });
      SESSION_LEVEL_DOC_TYPES.forEach((t) => {
        if (tDocs.some((d) => d.document_type === t && isLive(d.status))) coveredCount += 1;
      });
    });

    const expected =
      dConfigs.length * PER_UNIT_ONE_TIME_DOC_TYPES.length +
      trainerIds.length * SESSION_LEVEL_DOC_TYPES.length;
    return {
      dept,
      trainers: trainerIds.length,
      units: dConfigs.length,
      expected,
      covered: coveredCount,
      pct: expected > 0 ? Math.round((coveredCount / expected) * 100) : 0,
    };
  }).filter((d) => d.units > 0 || d.expected > 0);
}

export interface FlowStats {
  counts: Record<'submitted' | 'hod' | 'iqa' | 'dp' | 'archived' | 'rejected', number>;
  stages: Array<{ label: string; avg: number | null; count: number }>;
}

export function flowStats(docs: ReportDoc[]): FlowStats {
  const hours = (a?: string | null, b?: string | null) =>
    a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 36e5 : null;

  const collect = (label: string, sel: (d: ReportDoc) => number | null) => {
    const arr = docs.map(sel).filter((v): v is number => v !== null && v >= 0);
    return { label, avg: arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null, count: arr.length };
  };

  return {
    counts: {
      submitted: docs.filter((d) => d.status === 'SUBMITTED').length,
      hod: docs.filter((d) => d.status === 'HOD_APPROVED').length,
      iqa: docs.filter((d) => d.status === 'IQA_REVIEWED').length,
      dp: docs.filter((d) => d.status === 'DP_APPROVED').length,
      archived: docs.filter((d) => ['ARCHIVED', 'EXPORTED'].includes(d.status)).length,
      rejected: docs.filter((d) => d.status === 'REJECTED').length,
    },
    stages: [
      collect('Submitted → HOD verified', (d) => hours(d.submitted_at, d.hod_approved_at)),
      collect('HOD → IQAO reviewed', (d) => hours(d.hod_approved_at, d.iqa_reviewed_at)),
      collect('IQAO → DP approved', (d) => hours(d.iqa_reviewed_at || d.hod_approved_at, d.dp_approved_at)),
      collect('DP approved → archived', (d) => hours(d.dp_approved_at, d.archived_at)),
    ],
  };
}

/** Per-unit coverage used by the trainer My Units cards. */
export function unitCoverage(docs: ReportDoc[], unitCode: string) {
  const unitDocs = docs.filter((d) => d.unit_code === unitCode);
  const covered = coveredPairs(unitDocs);
  const missing = PER_UNIT_ONE_TIME_DOC_TYPES.filter((t) => !covered.has(key(unitCode, t)));
  const rejected = PER_UNIT_ONE_TIME_DOC_TYPES.filter((t) =>
    unitDocs.some((d) => d.document_type === t && d.status === 'REJECTED') && !covered.has(key(unitCode, t)),
  );
  const total = PER_UNIT_ONE_TIME_DOC_TYPES.length;
  const done = total - missing.length;
  return { done, total, missing: [...missing], rejected: [...rejected], pct: Math.round((done / total) * 100) };
}

/**
 * Session-level requirements (workload allocation) for one trainer.
 * These are submitted once per training session for the whole teaching load.
 */
export function sessionLevelCoverage(docs: ReportDoc[]) {
  const missing = SESSION_LEVEL_DOC_TYPES.filter((t) => !docs.some((d) => d.document_type === t && isLive(d.status)));
  const rejected = SESSION_LEVEL_DOC_TYPES.filter(
    (t) => missing.includes(t) && docs.some((d) => d.document_type === t && d.status === 'REJECTED'),
  );
  return {
    missing: [...missing],
    rejected: [...rejected],
    done: SESSION_LEVEL_DOC_TYPES.length - missing.length,
    total: SESSION_LEVEL_DOC_TYPES.length,
  };
}
