import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ProfileCompleteness {
  loading: boolean;
  complete: boolean;
  missing: string[];
  fullName: string | null;
  pfNumber: string | null;
  department: string | null;
  hasSignature: boolean;
  hasStamp: boolean;
}

/**
 * Mandatory profile details for accurate record keeping. Trainers cannot
 * upload/submit until these are filled in; approvers additionally need a
 * signature configured.
 */
export function useProfileCompleteness(): ProfileCompleteness {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['profile-completeness', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, pf_number, department, signature_url, stamp_url')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const missing: string[] = [];
  if (!data?.full_name || data.full_name.trim().length < 3) missing.push('full name');
  if (!data?.pf_number) missing.push('PF number');
  if (!data?.department) missing.push('department');

  return {
    loading: isLoading,
    complete: !isLoading && !!data && missing.length === 0,
    missing,
    fullName: data?.full_name ?? null,
    pfNumber: data?.pf_number ?? null,
    department: data?.department ?? null,
    hasSignature: !!data?.signature_url,
    hasStamp: !!data?.stamp_url,
  };
}
