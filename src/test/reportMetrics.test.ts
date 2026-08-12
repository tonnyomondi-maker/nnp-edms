import { describe, expect, it } from 'vitest';
import {
  trainerCoverage,
  departmentCoverage,
  missingByUnit,
  unitCoverage,
  sessionLevelCoverage,
  type ReportDoc,
  type ReportConfig,
  type ReportProfile,
} from '@/lib/reportMetrics';
import { PER_UNIT_ONE_TIME_DOC_TYPES } from '@/lib/sessions';

const DEPT = 'Computing & Informatics';
const TRAINER = 'trainer-1';

const profiles: ReportProfile[] = [{ user_id: TRAINER, full_name: 'Test Trainer', department: DEPT }];
const configs: ReportConfig[] = [{ trainer_id: TRAINER, department: DEPT, unit_code: 'ICT101' }];

function doc(partial: Partial<ReportDoc>): ReportDoc {
  return {
    id: Math.random().toString(36).slice(2),
    trainer_id: TRAINER,
    department: DEPT,
    unit_code: 'ICT101',
    document_type: 'Learning Plan',
    status: 'SUBMITTED',
    submitted_at: '2026-01-10T08:00:00Z',
    hod_approved_at: null,
    dp_approved_at: null,
    archived_at: null,
    ...partial,
  };
}

describe('coverage metrics', () => {
  it('counts a document type once per unit no matter how many upload attempts', () => {
    const docs = [
      doc({ status: 'REJECTED' }),
      doc({ status: 'REJECTED' }),
      doc({ status: 'REJECTED' }),
      doc({ status: 'HOD_APPROVED', version: 4 }),
    ];
    const [row] = trainerCoverage({ docs, configs, profiles });
    expect(row.covered).toBe(1);
    expect(row.expected).toBe(PER_UNIT_ONE_TIME_DOC_TYPES.length + 1); // + session-level workload
  });

  it('does not count rejected-only types as covered', () => {
    const docs = [doc({ status: 'REJECTED' })];
    const [row] = trainerCoverage({ docs, configs, profiles });
    expect(row.covered).toBe(0);
    expect(row.rejectedTypes).toBe(1);
  });

  it('treats workload allocation as one session-level requirement, not per unit', () => {
    const twoUnits: ReportConfig[] = [
      ...configs,
      { trainer_id: TRAINER, department: DEPT, unit_code: 'ICT102' },
    ];
    const docs = [doc({ document_type: 'Workload Allocation', unit_code: null, status: 'HOD_APPROVED' })];
    const [row] = trainerCoverage({ docs, configs: twoUnits, profiles });
    expect(row.expected).toBe(2 * PER_UNIT_ONE_TIME_DOC_TYPES.length + 1);
    expect(row.covered).toBe(1);
    expect(row.workloadOnFile).toBe(true);
  });

  it('never reports workload allocation as missing per unit', () => {
    const rows = missingByUnit({ docs: [], configs, profiles });
    expect(rows[0].missing).not.toContain('Workload Allocation');
    expect(unitCoverage([], 'ICT101').missing).not.toContain('Workload Allocation');
  });

  it('flags a missing session-level workload allocation', () => {
    expect(sessionLevelCoverage([]).missing).toEqual(['Workload Allocation']);
    expect(sessionLevelCoverage([doc({ document_type: 'Workload Allocation', status: 'ARCHIVED' })]).missing).toEqual([]);
  });

  it('department coverage matches per-trainer coverage', () => {
    const docs = [doc({ status: 'DP_APPROVED' }), doc({ status: 'REJECTED' })];
    const [dept] = departmentCoverage({ docs, configs, profiles }, [DEPT]);
    expect(dept.covered).toBe(1);
    expect(dept.expected).toBe(PER_UNIT_ONE_TIME_DOC_TYPES.length + 1);
  });
});
