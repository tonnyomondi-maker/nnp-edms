export type UserRole = 'TRAINER' | 'HOD' | 'DP_ACADEMICS' | 'IQA';

export type DocumentStatus = 'SUBMITTED' | 'HOD_APPROVED' | 'DP_APPROVED' | 'ARCHIVED' | 'REJECTED';

export type SubmissionType = 'ONE_TIME' | 'WEEKLY';

export type DocumentType = 'Learning Plan' | 'Personal Timetable' | 'Workload Allocation' | 'Scheme of Work' | 'Session Plan' | 'Class Attendance';

export const ONE_TIME_DOCS: DocumentType[] = ['Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work'];
export const WEEKLY_DOCS: DocumentType[] = ['Session Plan', 'Class Attendance'];

export const TERMS = ['Jan-April', 'May-Aug', 'Sept-Dec'];

export interface User {
  id: string;
  name: string;
  email: string;
  pfNumber: string;
  department: string;
  roles: UserRole[];
}

export interface TeachingAssignment {
  id: string;
  unitCode: string;
  unitName: string;
  className: string;
  department: string;
  term: string;
  year: number;
  trainerId: string;
}

export interface Document {
  id: string;
  assignmentId: string;
  trainerId: string;
  trainerName: string;
  documentType: DocumentType;
  submissionType: SubmissionType;
  weekNumber?: number;
  fileUrl: string;
  fileDriveId: string;
  status: DocumentStatus;
  unitCode: string;
  unitName: string;
  className: string;
  department: string;
  submittedAt: string;
  hodApprovedAt?: string;
  dpApprovedAt?: string;
  archivedAt?: string;
  rejectionReason?: string;
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: 'submission' | 'approval' | 'rejection' | 'archive';
  read: boolean;
  createdAt: string;
  documentId: string;
}

export const DEPARTMENTS = [
  'Computer Science',
  'Electrical Engineering',
  'Business Studies',
  'Mechanical Engineering',
  'Hospitality',
];

export const mockUsers: User[] = [
  { id: 'u1', name: 'James Mwangi', email: 'james@poly.ac.ke', pfNumber: 'PF001', department: 'Computer Science', roles: ['TRAINER'] },
  { id: 'u2', name: 'Grace Wanjiku', email: 'grace@poly.ac.ke', pfNumber: 'PF002', department: 'Computer Science', roles: ['TRAINER', 'HOD'] },
  { id: 'u3', name: 'Peter Ochieng', email: 'peter@poly.ac.ke', pfNumber: 'PF003', department: 'Electrical Engineering', roles: ['TRAINER'] },
  { id: 'u4', name: 'Mary Akinyi', email: 'mary@poly.ac.ke', pfNumber: 'PF004', department: 'Business Studies', roles: ['HOD'] },
  { id: 'u5', name: 'Dr. Samuel Kamau', email: 'samuel@poly.ac.ke', pfNumber: 'PF005', department: 'Computer Science', roles: ['DP_ACADEMICS'] },
  { id: 'u6', name: 'Prof. Elizabeth Njeri', email: 'elizabeth@poly.ac.ke', pfNumber: 'PF006', department: 'Computer Science', roles: ['IQA'] },
  { id: 'u7', name: 'John Kipchoge', email: 'john@poly.ac.ke', pfNumber: 'PF007', department: 'Electrical Engineering', roles: ['HOD'] },
];

export const mockAssignments: TeachingAssignment[] = [
  { id: 'a1', unitCode: 'CS101', unitName: 'Introduction to Programming', className: 'DIT Y1', department: 'Computer Science', term: 'Jan-April', year: 2026, trainerId: 'u1' },
  { id: 'a2', unitCode: 'CS205', unitName: 'Database Systems', className: 'DIT Y2', department: 'Computer Science', term: 'Jan-April', year: 2026, trainerId: 'u1' },
  { id: 'a3', unitCode: 'CS301', unitName: 'Software Engineering', className: 'DIT Y3', department: 'Computer Science', term: 'Jan-April', year: 2026, trainerId: 'u2' },
  { id: 'a4', unitCode: 'EE101', unitName: 'Circuit Analysis', className: 'DEE Y1', department: 'Electrical Engineering', term: 'Jan-April', year: 2026, trainerId: 'u3' },
  { id: 'a5', unitCode: 'EE202', unitName: 'Digital Electronics', className: 'DEE Y2', department: 'Electrical Engineering', term: 'Jan-April', year: 2026, trainerId: 'u3' },
];

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

export const mockDocuments: Document[] = [
  // Trainer u1 submissions
  { id: 'd1', assignmentId: 'a1', trainerId: 'u1', trainerName: 'James Mwangi', documentType: 'Learning Plan', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd1', status: 'DP_APPROVED', unitCode: 'CS101', unitName: 'Introduction to Programming', className: 'DIT Y1', department: 'Computer Science', submittedAt: daysAgo(10), hodApprovedAt: daysAgo(8), dpApprovedAt: daysAgo(6) },
  { id: 'd2', assignmentId: 'a1', trainerId: 'u1', trainerName: 'James Mwangi', documentType: 'Scheme of Work', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd2', status: 'HOD_APPROVED', unitCode: 'CS101', unitName: 'Introduction to Programming', className: 'DIT Y1', department: 'Computer Science', submittedAt: daysAgo(7), hodApprovedAt: daysAgo(5) },
  { id: 'd3', assignmentId: 'a1', trainerId: 'u1', trainerName: 'James Mwangi', documentType: 'Session Plan', submissionType: 'WEEKLY', weekNumber: 1, fileUrl: '#', fileDriveId: 'gd3', status: 'SUBMITTED', unitCode: 'CS101', unitName: 'Introduction to Programming', className: 'DIT Y1', department: 'Computer Science', submittedAt: daysAgo(2) },
  { id: 'd4', assignmentId: 'a1', trainerId: 'u1', trainerName: 'James Mwangi', documentType: 'Class Attendance', submissionType: 'WEEKLY', weekNumber: 1, fileUrl: '#', fileDriveId: 'gd4', status: 'SUBMITTED', unitCode: 'CS101', unitName: 'Introduction to Programming', className: 'DIT Y1', department: 'Computer Science', submittedAt: daysAgo(2) },
  { id: 'd5', assignmentId: 'a2', trainerId: 'u1', trainerName: 'James Mwangi', documentType: 'Learning Plan', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd5', status: 'REJECTED', unitCode: 'CS205', unitName: 'Database Systems', className: 'DIT Y2', department: 'Computer Science', submittedAt: daysAgo(5), rejectionReason: 'Missing learning outcomes for weeks 8-12' },
  // Trainer u2 (also HOD)
  { id: 'd6', assignmentId: 'a3', trainerId: 'u2', trainerName: 'Grace Wanjiku', documentType: 'Learning Plan', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd6', status: 'SUBMITTED', unitCode: 'CS301', unitName: 'Software Engineering', className: 'DIT Y3', department: 'Computer Science', submittedAt: daysAgo(1) },
  // Trainer u3
  { id: 'd7', assignmentId: 'a4', trainerId: 'u3', trainerName: 'Peter Ochieng', documentType: 'Learning Plan', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd7', status: 'SUBMITTED', unitCode: 'EE101', unitName: 'Circuit Analysis', className: 'DEE Y1', department: 'Electrical Engineering', submittedAt: daysAgo(3) },
  { id: 'd8', assignmentId: 'a4', trainerId: 'u3', trainerName: 'Peter Ochieng', documentType: 'Personal Timetable', submissionType: 'ONE_TIME', fileUrl: '#', fileDriveId: 'gd8', status: 'HOD_APPROVED', unitCode: 'EE101', unitName: 'Circuit Analysis', className: 'DEE Y1', department: 'Electrical Engineering', submittedAt: daysAgo(6), hodApprovedAt: daysAgo(4) },
  { id: 'd9', assignmentId: 'a5', trainerId: 'u3', trainerName: 'Peter Ochieng', documentType: 'Session Plan', submissionType: 'WEEKLY', weekNumber: 1, fileUrl: '#', fileDriveId: 'gd9', status: 'ARCHIVED', unitCode: 'EE202', unitName: 'Digital Electronics', className: 'DEE Y2', department: 'Electrical Engineering', submittedAt: daysAgo(14), hodApprovedAt: daysAgo(12), dpApprovedAt: daysAgo(10), archivedAt: daysAgo(8) },
];

export const mockNotifications: Notification[] = [
  { id: 'n1', userId: 'u2', message: 'James Mwangi submitted Session Plan for CS101', type: 'submission', read: false, createdAt: daysAgo(2), documentId: 'd3' },
  { id: 'n2', userId: 'u5', message: 'Grace Wanjiku approved Scheme of Work for CS101', type: 'approval', read: false, createdAt: daysAgo(5), documentId: 'd2' },
  { id: 'n3', userId: 'u1', message: 'Your Learning Plan for CS205 was rejected', type: 'rejection', read: true, createdAt: daysAgo(5), documentId: 'd5' },
  { id: 'n4', userId: 'u6', message: 'Dr. Samuel approved Learning Plan for CS101', type: 'approval', read: false, createdAt: daysAgo(6), documentId: 'd1' },
];

export function getStatusLabel(status: DocumentStatus): string {
  const labels: Record<DocumentStatus, string> = {
    SUBMITTED: 'Submitted',
    HOD_APPROVED: 'HOD Approved',
    DP_APPROVED: 'DP Approved',
    ARCHIVED: 'Archived',
    REJECTED: 'Rejected',
  };
  return labels[status];
}

export function getDocCompletionForAssignment(assignmentId: string, docs: Document[]): { total: number; completed: number } {
  const assignmentDocs = docs.filter(d => d.assignmentId === assignmentId);
  const oneTimeDone = ONE_TIME_DOCS.filter(dt => assignmentDocs.some(d => d.documentType === dt)).length;
  // For weekly, count week 1 as baseline
  const weeklyDone = WEEKLY_DOCS.filter(dt => assignmentDocs.some(d => d.documentType === dt && d.weekNumber === 1)).length;
  return { total: ONE_TIME_DOCS.length + WEEKLY_DOCS.length, completed: oneTimeDone + weeklyDone };
}
