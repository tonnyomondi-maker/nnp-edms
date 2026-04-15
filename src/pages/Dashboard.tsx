import { useAuth } from '@/contexts/AuthContext';
import { mockDocuments, mockAssignments, UserRole } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { FileText, Clock, CheckCircle2, XCircle, Archive, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

const roleInfo: Record<UserRole, { label: string; desc: string; color: string; icon: React.ReactNode }> = {
  TRAINER: { label: 'Trainer', desc: 'Submit & track documents', color: 'bg-role-trainer-bg border-role-trainer', icon: <FileText className="w-6 h-6 text-role-trainer" /> },
  HOD: { label: 'Head of Dept', desc: 'Review department submissions', color: 'bg-role-hod-bg border-role-hod', icon: <Users className="w-6 h-6 text-role-hod" /> },
  DP_ACADEMICS: { label: 'DP Academics', desc: 'Approve across departments', color: 'bg-role-dp-bg border-role-dp', icon: <CheckCircle2 className="w-6 h-6 text-role-dp" /> },
  IQA: { label: 'IQA Officer', desc: 'Archive final documents', color: 'bg-role-iqa-bg border-role-iqa', icon: <Archive className="w-6 h-6 text-role-iqa" /> },
};

export default function Dashboard() {
  const { currentUser, activeRole } = useAuth();

  const myDocs = mockDocuments.filter(d => d.trainerId === currentUser.id);
  const submitted = myDocs.filter(d => d.status === 'SUBMITTED').length;
  const approved = myDocs.filter(d => ['HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED'].includes(d.status)).length;
  const rejected = myDocs.filter(d => d.status === 'REJECTED').length;

  // Pending for approval roles
  const pendingHOD = mockDocuments.filter(d => d.status === 'SUBMITTED' && d.department === currentUser.department && d.trainerId !== currentUser.id).length;
  const pendingDP = mockDocuments.filter(d => d.status === 'HOD_APPROVED').length;
  const pendingIQA = mockDocuments.filter(d => d.status === 'DP_APPROVED').length;

  const recentDocs = myDocs.slice(0, 3);

  return (
    <div>
      <PageHeader title={`Welcome, ${currentUser.name.split(' ')[0]}`} subtitle={`${currentUser.department} • ${currentUser.pfNumber}`} />

      {/* Role Card */}
      <Card className={`mb-4 border-l-4 ${roleInfo[activeRole].color}`}>
        <CardContent className="p-4 flex items-center gap-3">
          {roleInfo[activeRole].icon}
          <div>
            <p className="font-semibold text-sm">{roleInfo[activeRole].label}</p>
            <p className="text-xs text-muted-foreground">{roleInfo[activeRole].desc}</p>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {activeRole === 'TRAINER' && (
          <>
            <StatCard icon={<Clock className="w-4 h-4 text-status-submitted" />} label="Pending" value={submitted} />
            <StatCard icon={<CheckCircle2 className="w-4 h-4 text-status-approved" />} label="Approved" value={approved} />
            <StatCard icon={<XCircle className="w-4 h-4 text-status-rejected" />} label="Rejected" value={rejected} />
          </>
        )}
        {activeRole === 'HOD' && (
          <>
            <StatCard icon={<Clock className="w-4 h-4 text-status-submitted" />} label="To Review" value={pendingHOD} />
            <StatCard icon={<FileText className="w-4 h-4 text-primary" />} label="Dept Docs" value={mockDocuments.filter(d => d.department === currentUser.department).length} />
            <StatCard icon={<Users className="w-4 h-4 text-muted-foreground" />} label="Trainers" value={mockAssignments.filter(a => a.department === currentUser.department).length} />
          </>
        )}
        {activeRole === 'DP_ACADEMICS' && (
          <>
            <StatCard icon={<Clock className="w-4 h-4 text-status-review" />} label="To Approve" value={pendingDP} />
            <StatCard icon={<CheckCircle2 className="w-4 h-4 text-status-approved" />} label="Approved" value={mockDocuments.filter(d => d.status === 'DP_APPROVED').length} />
            <StatCard icon={<FileText className="w-4 h-4 text-muted-foreground" />} label="Total" value={mockDocuments.length} />
          </>
        )}
        {activeRole === 'IQA' && (
          <>
            <StatCard icon={<Clock className="w-4 h-4 text-status-approved" />} label="To Archive" value={pendingIQA} />
            <StatCard icon={<Archive className="w-4 h-4 text-status-archived" />} label="Archived" value={mockDocuments.filter(d => d.status === 'ARCHIVED').length} />
            <StatCard icon={<FileText className="w-4 h-4 text-muted-foreground" />} label="Total" value={mockDocuments.length} />
          </>
        )}
      </div>

      {/* Quick Actions */}
      {activeRole === 'TRAINER' && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/teaching">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="text-xs font-medium">Submit Document</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/submissions">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 text-center">
                  <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="text-xs font-medium">View Submissions</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <h2 className="text-sm font-semibold mb-3">Recent Documents</h2>
      <div className="space-y-3">
        {recentDocs.length > 0 ? (
          recentDocs.map(doc => <DocumentCard key={doc.id} doc={doc} />)
        ) : (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No documents yet</CardContent></Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className="flex justify-center mb-1">{icon}</div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function ClipboardCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>
    </svg>
  );
}
