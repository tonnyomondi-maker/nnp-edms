// Alerts Super Admins when a security-sensitive action was denied recently.
// Denied attempts are written server-side to `security_events`.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';

export function DeniedAttemptsAlert() {
  const { data } = useQuery({
    queryKey: ['denied-attempts-24h'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from('security_events' as never)
        .select('id, action, created_at')
        .gte('created_at' as never, since as never)
        .order('created_at' as never, { ascending: false });
      if (error) return [];
      return (data as unknown as { id: string; action: string }[]) || [];
    },
  });

  if (!data || data.length === 0) return null;

  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>{data.length} denied attempt{data.length > 1 ? 's' : ''} in the last 24 hours</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
        <span>Blocked attempts to create notifications or permanently delete verifier packs were recorded.</span>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/audit-log?denied=1">Review in audit log</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
