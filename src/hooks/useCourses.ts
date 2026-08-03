import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CourseRow {
  id: string;
  department: string;
  code: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useCourses(department?: string | null) {
  return useQuery({
    queryKey: ['courses', department ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('courses' as never).select('*').order('department').order('code');
      if (department) q = q.eq('department', department);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as CourseRow[];
    },
  });
}

export function useUpsertCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; department: string; code: string; name: string; active?: boolean }) => {
      const { data, error } = await supabase
        .from('courses' as never)
        .upsert({ ...input, active: input.active ?? true } as never, { onConflict: 'department,code' })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as CourseRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
  });
}

export function useDeleteCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('courses' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
  });
}
