import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useMyAssignments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['assignments', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('*')
        .eq('trainer_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useAssignment(id: string) {
  return useQuery({
    queryKey: ['assignments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}
