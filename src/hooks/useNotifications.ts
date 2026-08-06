import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface NotificationRow {
  id: string;
  user_id: string;
  document_id: string | null;
  kind: string;
  stage: string | null;
  stage_order: number | null;
  stage_total: number | null;
  stamp_version: string | null;
  layout_version: string | null;
  title: string;
  message: string | null;
  note: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications' as never)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as NotificationRow[];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
}

export function useUnreadNotificationCount() {
  const { data } = useNotifications();
  return (data || []).filter((n) => !n.read_at).length;
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | 'ALL') => {
      let q = supabase.from('notifications' as never).update({ read_at: new Date().toISOString() } as never).is('read_at', null);
      if (ids !== 'ALL') q = q.in('id', ids);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
