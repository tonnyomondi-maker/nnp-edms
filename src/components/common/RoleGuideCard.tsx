import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { X, Compass, ArrowRight } from 'lucide-react';

interface GuideStep {
  title: string;
  detail: string;
  to?: string;
  cta?: string;
}

const GUIDES: Record<UserRole, { headline: string; steps: GuideStep[] }> = {
  TRAINER: {
    headline: 'As a Trainer you prepare and submit your teaching documents each training session.',
    steps: [
      { title: '1. Set up your units', detail: 'Add the units you teach for the open session, with course type (Cycle or Modular) and sessions per week.', to: '/teaching', cta: 'My Units' },
      { title: '2. Download the approved samples', detail: 'Open the Sample templates panel on the upload screen and use the published format for each document type.', to: '/upload', cta: 'Templates' },
      { title: '3. Upload your documents', detail: 'Session documents (Personal Timetable and Workload Allocation), unit documents (Learning Plan and Course Outline), weekly teaching records (Session Plan and Class Attendance), and Records of Work Covered twice per training session (mid-session and end-session).', to: '/upload', cta: 'Upload' },
      { title: '4. Track and fix rejections', detail: 'Follow each document from HOD to DP Academics to IQAO. If rejected, read the comment, edit and resubmit.', to: '/submissions', cta: 'My Submissions' },
    ],
  },
  HOD: {
    headline: 'As Head of Department you are the first verification stage for your department.',
    steps: [
      { title: '1. Review the department queue', detail: 'Documents arrive as SUBMITTED. Group by term/module or trainer to work through them systematically.', to: '/hod/queue', cta: 'Queue' },
      { title: '2. Compare against the sample', detail: 'Open the Sample templates panel to check the submission matches the approved institutional format.', to: '/hod/queue', cta: 'Queue' },
      { title: '3. Sign and approve, or reject with a reason', detail: 'Place your signature/stamp once and bulk-apply it to several documents. Rejections must carry a clear comment.', to: '/hod/queue', cta: 'Queue' },
      { title: '4. Monitor trainer completeness', detail: 'Use the Trainers view and Reports to spot missing documents before the session closes.', to: '/hod/dashboard', cta: 'Trainers' },
    ],
  },
  DP_ACADEMICS: {
    headline: 'As Deputy Principal Academics you approve HOD-verified documents across all departments.',
    steps: [
      { title: '1. Work the approvals queue', detail: 'Only HOD-approved documents reach you. Group by session, then department or module.', to: '/dp/queue', cta: 'Approvals' },
      { title: '2. Approve or return to HOD', detail: 'Returning to the HOD stage requires a return note explaining what must be corrected.', to: '/dp/queue', cta: 'Approvals' },
      { title: '3. Export for records', detail: 'Generate ZIP exports per session, department or trainer when you need offline copies.', to: '/admin/exports', cta: 'Exports' },
    ],
  },
  IQA: {
    headline: 'As IQAO you archive approved documents and manage external verification.',
    steps: [
      { title: '1. Archive DP-approved documents', detail: 'Sign and archive individually or in bulk; a nested Department/Trainer ZIP is produced for your records.', to: '/iqa/archive', cta: 'Archive' },
      { title: '2. Build verification packs', detail: 'Create department packs, choose which document types they contain, and share secure links with verifiers.', to: '/iqa/verifier-packs', cta: 'Packs' },
      { title: '3. Assign verifiers', detail: 'Maintain the verifier directory and assign the same verifier set to many packs at once.', to: '/iqa/bulk-assign', cta: 'Bulk assign' },
      { title: '4. Keep Google Drive storage healthy', detail: 'Use the Drive health and archive tools to confirm approved files remain recoverable.', to: '/iqa/archive', cta: 'Archive' },
    ],
  },
  SUPER_ADMIN: {
    headline: 'As Super Admin you configure the portal and keep the institution-wide record safe.',
    steps: [
      { title: '1. Open the training session', detail: 'Set the academic year and term (Jan–Apr, May–Aug, Sep–Dec) and mark it current — this drives every upload and view.', to: '/admin/session-config', cta: 'Sessions' },
      { title: '2. Publish document templates', detail: 'Upload the approved sample for each document type so trainers submit — and approvers verify — the same format.', to: '/admin/templates', cta: 'Templates' },
      { title: '3. Manage users and roles', detail: 'Create accounts, assign departments and roles. Roles decide what each person can do.', to: '/admin/users', cta: 'Users' },
      { title: '4. Watch efficiency and storage', detail: 'Track workflow and storage health; new academic PDFs are stored directly in Google Drive while Supabase retains metadata and workflow records.', to: '/admin/efficiency', cta: 'Efficiency' },
    ],
  },
};

const key = (role: UserRole, userId?: string) => `edms_guide_dismissed_${userId || 'anon'}_${role}`;

export function RoleGuideCard() {
  const { activeRole, currentUser } = useAuth();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    setDismissed(localStorage.getItem(key(activeRole, currentUser.id)) === '1');
  }, [activeRole, currentUser]);

  if (!currentUser || dismissed) return null;
  const guide = GUIDES[activeRole];
  if (!guide) return null;

  const dismiss = () => {
    localStorage.setItem(key(activeRole, currentUser.id), '1');
    setDismissed(true);
  };

  return (
    <Card className="mb-4 border-primary/40 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          <Compass className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">What you need to do here</p>
            <p className="text-xs text-muted-foreground mt-0.5">{guide.headline}</p>
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={dismiss} aria-label="Dismiss guide">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <ol className="mt-3 space-y-2">
          {guide.steps.map((s) => (
            <li key={s.title} className="rounded-md border bg-card p-2.5">
              <p className="text-xs font-semibold">{s.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</p>
              {s.to && (
                <Link
                  to={s.to}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  {s.cta || 'Open'} <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </li>
          ))}
        </ol>

        <Button size="sm" variant="outline" className="mt-3 h-7 text-xs" onClick={dismiss}>
          Got it, hide this
        </Button>
      </CardContent>
    </Card>
  );
}

/** Small link that lets a user bring the guide back. */
export function ReplayGuideButton() {
  const { activeRole, currentUser } = useAuth();
  if (!currentUser) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs"
      onClick={() => {
        localStorage.removeItem(key(activeRole, currentUser.id));
        window.location.reload();
      }}
    >
      <Compass className="w-3.5 h-3.5 mr-1" /> Show role guide
    </Button>
  );
}
