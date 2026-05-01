import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SessionTerm } from '@/lib/sessions';

export interface UnitSessionConfigRow {
  id: string;
  trainer_id: string;
  department: string;
  unit_code: string;
  unit_name: string | null;
  class_code: string | null;
  session_year: number;
  session_term: SessionTerm;
  sessions_per_week: number;
  term_number: number | null;
  created_at: string;
  updated_at: string;
}

export function useMyUnitConfigs(year?: number, term?: SessionTerm) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['unit-configs', 'mine', user?.id, year, term],
    queryFn: async () => {
      let q = supabase
        .from('unit_session_config' as never)
        .select('*')
        .eq('trainer_id', user!.id);
      if (year !== undefined) q = q.eq('session_year', year);
      if (term) q = q.eq('session_term', term);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as UnitSessionConfigRow[];
    },
    enabled: !!user,
  });
}

export function useUpsertUnitConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      department: string;
      unit_code: string;
      unit_name?: string;
      class_code?: string;
      session_year: number;
      session_term: SessionTerm;
      sessions_per_week: number;
      term_number?: number | null;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const payload = { ...input, trainer_id: user.id };
      const { data, error } = await supabase
        .from('unit_session_config' as never)
        .upsert(payload as never, {
          onConflict: 'trainer_id,unit_code,session_year,session_term',
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as UnitSessionConfigRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-configs'] });
    },
  });
}
