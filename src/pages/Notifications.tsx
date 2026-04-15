import { PageHeader } from '@/components/common/PageHeader';
import { Bell } from 'lucide-react';

export default function Notifications() {
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Stay updated" />
      <div className="text-center py-8">
        <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No notifications yet</p>
        <p className="text-xs text-muted-foreground mt-1">Notifications will appear here as documents move through the approval workflow.</p>
      </div>
    </div>
  );
}
