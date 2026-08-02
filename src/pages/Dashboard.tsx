import { useAuth, UserRole } from '@/contexts/AuthContext';
import { useMyDocuments } from '@/hooks/useDocuments';
import { useMyAssignments } from '@/hooks/useAssignments';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/PageHeader';
import { DocumentCard } from '@/components/common/DocumentCard';
import { FileText, Clock, CheckCircle2, XCircle, Archive, Users, BookOpen, Loader2, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HodBlock, DpBlock, IqaBlock, SuperAdminBlock } from '@/components/dashboard/RoleDashboardBlocks';
import { RoleGuideCard } from '@/components/common/RoleGuideCard';


const roleInfo: Record<UserRole, { label: string; desc: string; icon: React.ReactNode }> = {
  TRAINER: { label: 'Trainer', desc: 'Submit & track documents', icon: <FileText className="w-6 h-6 text-primary" /> },
  HOD: { label: 'Head of Dept', desc: 'Review department submissions', icon: <Users className="w-6 h-6 text-primary" /> },
  DP_ACADEMICS: { label: 'DP Academics', desc: 'Approve across departments', icon: <CheckCircle2 className="w-6 h-6 text-primary" /> },
  IQA: { label: 'IQA Officer', desc: 'Archive final documents', icon: <Archive className="w-6 h-6 text-primary" /> },
  SUPER_ADMIN: { label: 'Super Admin', desc: 'System setup & roles', icon: <Shield className="w-6 h-6 text-primary" /> },
};

export default function Dashboard() {
  const { currentUser, activeRole } = useAuth();
  const { data: myDocs, isLoading: loadingDocs } = useMyDocuments();
  const { data: assignments, isLoading: loadingAssignments } = useMyAssignments();

  if (!currentUser) return null;

  const isLoading = loadingDocs || loadingAssignments;
  const docs = myDocs || [];
  const info = roleInfo[activeRole];

  const submitted = docs.filter(d => d.status === 'SUBMITTED').length;
  const approved = docs.filter(d => ['HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED'].includes(d.status)).length;
  const rejected = docs.filter(d => d.status === 'REJECTED').length;
  const recentDocs = docs.slice(0, 5);

  return (
    <div>
      <PageHeader title={`Welcome, ${currentUser.name.split(' ')[0]}`} subtitle={`${currentUser.department || ''} • ${currentUser.pfNumber || ''}`} />

      <RoleGuideCard />


      <Card className="mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {info.icon}
          </div>
          <div>
            <p className="font-semibold text-sm">{info.label}</p>
            <p className="text-xs text-muted-foreground">{info.desc}</p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard icon={<Clock className="w-4 h-4 text-primary" />} label="My Pending" value={submitted} />
            <StatCard icon={<CheckCircle2 className="w-4 h-4 text-primary" />} label="My Approved" value={approved} />
            <StatCard icon={<XCircle className="w-4 h-4 text-destructive" />} label="My Rejected" value={rejected} />
          </div>

          {/* Role-aware live widgets */}
          {activeRole === 'HOD' && currentUser.department && (
            <div className="mb-6"><HodBlock department={currentUser.department} /></div>
          )}
          {activeRole === 'DP_ACADEMICS' && <div className="mb-6"><DpBlock /></div>}
          {activeRole === 'IQA' && <div className="mb-6"><IqaBlock /></div>}
          {activeRole === 'SUPER_ADMIN' && <div className="mb-6"><SuperAdminBlock /></div>}


          {activeRole === 'TRAINER' && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/teaching">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 text-center">
                      <BookOpen className="w-8 h-8 mx-auto mb-2 text-primary" />
                      <p className="text-xs font-medium">My Teaching</p>
                      <p className="text-xs text-muted-foreground">{(assignments || []).length} units</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link to="/submissions">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 text-center">
                      <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
                      <p className="text-xs font-medium">Submissions</p>
                      <p className="text-xs text-muted-foreground">{docs.length} docs</p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>
          )}

          {recentDocs.length > 0 && (
            <>
              <h2 className="text-sm font-semibold mb-3">Recent Documents</h2>
              <div className="space-y-3">
                {recentDocs.map(doc => <DocumentCard key={doc.id} doc={doc} />)}
              </div>
            </>
          )}

          {recentDocs.length === 0 && (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No documents yet</CardContent></Card>
          )}
        </>
      )}
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
