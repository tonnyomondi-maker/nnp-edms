import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SessionTerm } from '@/lib/sessions';

export interface AcademicSession {
  id: string;
  session_year: number;
  session_term: SessionTerm;
  status: 'PLANNED' | 'OPEN' | 'LOCKED' | 'CLOSED';
  submission_opens_at: string | null;
  submission_closes_at: string | null;
  late_grace_days: number;
  is_current: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useAcademicSessions() {
  return useQuery({
    queryKey: ['academic_sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_sessions' as never)
        .select('*')
        .order('session_year', { ascending: false })
        .order('session_term', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as AcademicSession[];
    },
  });
}

export function useCurrentSession() {
  return useQuery({
    queryKey: ['academic_sessions', 'current'],
    queryFn: async () => {
      const { data } = await supabase
        .from('academic_sessions' as never)
        .select('*')
        .eq('is_current', true)
        .maybeSingle();
      return (data as unknown as AcademicSession) || null;
    },
  });
}

export function useUpsertSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AcademicSession> & { session_year: number; session_term: SessionTerm }) => {
      const { data, error } = await supabase
        .from('academic_sessions' as never)
        .upsert(input as never, { onConflict: 'session_year,session_term' })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as AcademicSession;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['academic_sessions'] }),
  });
}

export function useSetCurrentSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('academic_sessions' as never)
        .update({ is_current: true } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['academic_sessions'] }),
  });
}

/**
 * Returns { allowed, reason } for submitting into a given (year, term).
 * If no matching session row exists, submissions are ALLOWED (backwards compatible).
 * If a session exists but is not OPEN, or outside its window (grace-aware), blocks.
 */
export async function checkSubmissionWindow(year: number, term: SessionTerm): Promise<{ allowed: boolean; reason?: string }> {
  const { data } = await supabase
    .from('academic_sessions' as never)
    .select('*')
    .eq('session_year' as never, year as never)
    .eq('session_term' as never, term as never)
    .maybeSingle();
  const s = data as unknown as AcademicSession | null;
  if (!s) return { allowed: true };
  if (s.status === 'CLOSED') return { allowed: false, reason: `Session ${term} ${year} is closed for submissions.` };
  if (s.status === 'LOCKED') return { allowed: false, reason: `Session ${term} ${year} is locked by the administrator.` };
  if (s.status === 'PLANNED') return { allowed: false, reason: `Session ${term} ${year} has not been opened yet.` };
  const now = new Date();
  if (s.submission_opens_at && now < new Date(s.submission_opens_at)) {
    return { allowed: false, reason: `Submissions for ${term} ${year} open on ${new Date(s.submission_opens_at).toLocaleDateString()}.` };
  }
  if (s.submission_closes_at) {
    const close = new Date(s.submission_closes_at);
    close.setDate(close.getDate() + (s.late_grace_days || 0));
    if (now > close) return { allowed: false, reason: `Submission window for ${term} ${year} has ended (incl. ${s.late_grace_days}d grace).` };
  }
  return { allowed: true };
}
