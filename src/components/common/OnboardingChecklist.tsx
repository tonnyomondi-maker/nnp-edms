import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { useProfileCompleteness } from '@/hooks/useProfileCompleteness';
import { CheckCircle2, ArrowRight, ListChecks, AlertTriangle } from 'lucide-react';

interface Step {
  id: string;
  title: string;
  detail: string;
  to?: string;
  cta?: string;
  /** Auto-completed from live data instead of a manual tick. */
  auto?: 'profile' | 'signature';
  required?: boolean;
}

const PROFILE_STEP: Step = {
  id: 'profile',
  title: 'Complete your profile (required)',
  detail: 'Full name, PF number and department must be filled in — every document, approval and export is keyed to these details.',
  to: '/profile',
  cta: 'Profile Settings',
  auto: 'profile',
  required: true,
};

const SIGNATURE_STEP: Step = {
  id: 'signature',
  title: 'Set up your signature and stamp (required)',
  detail: 'Upload, draw or type a signature and add your official stamp in Profile Settings. Approvals embed these on the PDF.',
  to: '/profile',
  cta: 'Profile Settings',
  auto: 'signature',
  required: true,
};

const CHECKLISTS: Record<UserRole, Step[]> = {
  TRAINER: [
    PROFILE_STEP,
    { id: 'units', title: 'Key in your units for the session', detail: 'Add every unit you teach, linked to its course. The upload form only offers units you have keyed in.', to: '/teaching', cta: 'My Units' },
    { id: 'templates', title: 'Download the approved templates', detail: 'Use the published sample for each document type so verification is straightforward.', to: '/upload', cta: 'Templates' },
    { id: 'upload', title: 'Upload your documents as PDF', detail: 'Pick the unit, then attach PDFs. Word files must be exported to PDF first.', to: '/upload', cta: 'Upload' },
    { id: 'track', title: 'Track approvals and fix rejections', detail: 'Follow HOD → IQAO review → DP Academics → IQAO archival, and resubmit anything rejected.', to: '/submissions', cta: 'My Submissions' },
  ],
  HOD: [
    PROFILE_STEP,
    SIGNATURE_STEP,
    { id: 'queue', title: 'Work your department queue', detail: 'Filter by course and trainer, compare against the sample, then verify or reject with a comment.', to: '/hod/queue', cta: 'Queue' },
    { id: 'bulk', title: 'Use bulk sign for volume', detail: 'Select several documents and apply your signature once — an approval sheet is appended automatically.', to: '/hod/queue', cta: 'Queue' },
  ],
  DP_ACADEMICS: [
    PROFILE_STEP,
    SIGNATURE_STEP,
    { id: 'queue', title: 'Approve IQAO-reviewed documents', detail: 'Only documents reviewed by IQAO reach you. Group by module or department.', to: '/dp/queue', cta: 'Approvals' },
  ],
  IQA: [
    PROFILE_STEP,
    SIGNATURE_STEP,
    { id: 'review', title: 'Review HOD-verified documents', detail: 'Your review sits between HOD verification and DP approval.', to: '/iqa/review', cta: 'Review queue' },
    { id: 'archive', title: 'Archive DP-approved documents', detail: 'Archive individually or in bulk and download the nested Department/Trainer ZIP.', to: '/iqa/archive', cta: 'Archive' },
  ],
  SUPER_ADMIN: [
    PROFILE_STEP,
    { id: 'session', title: 'Open the training session', detail: 'Set academic year and term (Jan–Apr, May–Aug, Sep–Dec) and mark it current.', to: '/admin/session-config', cta: 'Sessions' },
    { id: 'courses', title: 'Set up courses per department', detail: 'Units are linked to courses, so courses must exist before trainers key in units.', to: '/admin/courses', cta: 'Courses' },
    { id: 'templates', title: 'Publish document templates', detail: 'Upload the approved sample for each document type.', to: '/admin/templates', cta: 'Templates' },
    { id: 'users', title: 'Create users and assign roles', detail: 'Roles decide what each person can do in the portal.', to: '/admin/users', cta: 'Users' },
  ],
};

const storeKey = (role: UserRole, userId?: string) => `edms_checklist_${userId || 'anon'}_${role}`;

export function OnboardingChecklist() {
  const { activeRole, currentUser } = useAuth();
  const profile = useProfileCompleteness();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    try {
      setDone(JSON.parse(localStorage.getItem(storeKey(activeRole, currentUser.id)) || '{}'));
    } catch {
      setDone({});
    }
  }, [activeRole, currentUser]);

  if (!currentUser || hidden) return null;
  const steps = CHECKLISTS[activeRole] || [];

  const isDone = (s: Step) => {
    if (s.auto === 'profile') return profile.complete;
    if (s.auto === 'signature') return profile.hasSignature;
    return !!done[s.id];
  };

  const toggle = (s: Step, value: boolean) => {
    if (s.auto) return;
    const next = { ...done, [s.id]: value };
    setDone(next);
    localStorage.setItem(storeKey(activeRole, currentUser.id), JSON.stringify(next));
  };

  const completed = steps.filter(isDone).length;
  const pct = steps.length ? (completed / steps.length) * 100 : 0;
  const profileBlocked = !profile.loading && !profile.complete;

  if (completed === steps.length) return null;

  return (
    <Card className="mb-4 border-primary/40 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          <ListChecks className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Your setup checklist</p>
            <p className="text-xs text-muted-foreground mt-0.5">{completed} of {steps.length} steps done</p>
            <Progress value={pct} className="h-1.5 mt-2" />
          </div>
        </div>

        {profileBlocked && (
          <div className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              Uploads and submissions are blocked until your profile is complete. Missing: <strong>{profile.missing.join(', ')}</strong>.{' '}
              <Link to="/profile" className="underline font-medium">Update profile</Link>
            </div>
          </div>
        )}

        <ol className="mt-3 space-y-2">
          {steps.map((s) => {
            const complete = isDone(s);
            return (
              <li key={s.id} className="rounded-md border bg-card p-2.5 flex items-start gap-2">
                {s.auto ? (
                  <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${complete ? 'text-emerald-600' : 'text-muted-foreground/40'}`} />
                ) : (
                  <Checkbox checked={complete} onCheckedChange={(v) => toggle(s, !!v)} className="mt-0.5" aria-label={s.title} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold ${complete ? 'line-through text-muted-foreground' : ''}`}>{s.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</p>
                  {s.to && !complete && (
                    <Link to={s.to} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                      {s.cta || 'Open'} <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <Button size="sm" variant="ghost" className="mt-3 h-7 text-xs" onClick={() => setHidden(true)}>
          Hide for now
        </Button>
      </CardContent>
    </Card>
  );
}
