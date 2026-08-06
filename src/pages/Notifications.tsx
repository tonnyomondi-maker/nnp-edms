import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNotifications, useMarkNotificationsRead } from '@/hooks/useNotifications';
import { Bell, CheckCheck, CheckCircle2, XCircle, RotateCcw, Loader2 } from 'lucide-react';

const KIND_META: Record<string, { icon: typeof CheckCircle2; label: string; tone: string }> = {
  APPROVED: { icon: CheckCircle2, label: 'Approved', tone: 'text-emerald-600' },
  REJECTED: { icon: XCircle, label: 'Rejected', tone: 'text-destructive' },
  RETURNED: { icon: RotateCcw, label: 'Returned', tone: 'text-amber-600' },
};

export default function Notifications() {
  const { data = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <div className="pb-8">
      <PageHeader title="Notifications" subtitle="Approval, rejection and return notices with full stamp traceability" />

      {unread > 0 && (
        <div className="flex justify-end mb-3">
          <Button size="sm" variant="outline" onClick={() => markRead.mutate('ALL')} disabled={markRead.isPending}>
            <CheckCheck className="w-4 h-4 mr-1" /> Mark all read ({unread})
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : data.length === 0 ? (
        <div className="text-center py-8">
          <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No notifications yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Notifications appear here as your documents move through the approval workflow.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((n) => {
            const meta = KIND_META[n.kind] || KIND_META.APPROVED;
            const Icon = meta.icon;
            return (
              <Card key={n.id} className={n.read_at ? '' : 'border-primary/40 bg-primary/5'}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>}
                      {n.note && <p className="text-xs italic mt-1">"{n.note}"</p>}
                      <div className="flex flex-wrap gap-1 mt-2">
                        <Badge variant="secondary" className="text-[10px]">{meta.label}</Badge>
                        {n.stage_order != null && (
                          <Badge variant="outline" className="text-[10px]">
                            Stage {n.stage_order}{n.stage_total ? ` of ${n.stage_total}` : ''}
                            {n.stage ? ` · ${n.stage.replace('_', ' ')}` : ''}
                          </Badge>
                        )}
                        {n.stamp_version && <Badge variant="outline" className="text-[10px]">Stamp v{n.stamp_version}</Badge>}
                        {n.layout_version && <Badge variant="outline" className="text-[10px]">Layout {n.layout_version}</Badge>}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!n.read_at && (
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markRead.mutate([n.id])}>
                        Mark read
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
