import { useAuth } from '@/contexts/AuthContext';
import { mockNotifications } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Bell, FileText, CheckCircle2, XCircle, Archive } from 'lucide-react';

const typeIcons = {
  submission: FileText,
  approval: CheckCircle2,
  rejection: XCircle,
  archive: Archive,
};

const typeColors = {
  submission: 'text-status-submitted',
  approval: 'text-status-approved',
  rejection: 'text-status-rejected',
  archive: 'text-status-archived',
};

export default function Notifications() {
  const { currentUser } = useAuth();
  const notifications = mockNotifications.filter(n => n.userId === currentUser.id);

  return (
    <div>
      <PageHeader title="Notifications" subtitle={`${notifications.filter(n => !n.read).length} unread`} />
      <div className="space-y-3">
        {notifications.length > 0 ? (
          notifications.map(n => {
            const Icon = typeIcons[n.type];
            return (
              <Card key={n.id} className={n.read ? 'opacity-60' : ''}>
                <CardContent className="p-4 flex items-start gap-3">
                  <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${typeColors[n.type]}`} />
                  <div className="min-w-0">
                    <p className="text-sm">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="text-center py-12">
            <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}
