// Per-document-type approval policy. The Super Admin controls whether each
// document type may be approved with just a signature, or whether a stamp is
// required. Cached for 60s — these change rarely.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type DocumentType = Database['public']['Enums']['document_type'];

export interface DocTypePolicy {
  document_type: DocumentType;
  signature_only_allowed: boolean;
  stamp_required: boolean;
  forbid_text_only_fallback: boolean;
  notes: string | null;
  updated_at: string;
}

const DEFAULT_POLICY: Omit<DocTypePolicy, 'document_type' | 'updated_at'> = {
  signature_only_allowed: false,
  stamp_required: true,
  forbid_text_only_fallback: false,
  notes: null,
};

export function useDocTypePolicies() {
  return useQuery({
    queryKey: ['document_type_policy'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_type_policy' as never)
        .select('*');
      if (error) throw error;
      return (data as unknown as DocTypePolicy[]) || [];
    },
  });
}

export function policyFor(policies: DocTypePolicy[] | undefined, type: DocumentType | string | null | undefined): DocTypePolicy {
  const row = policies?.find((p) => p.document_type === type);
  return {
    document_type: (type as DocumentType) ?? ('Class Attendance' as DocumentType),
    signature_only_allowed: row?.signature_only_allowed ?? DEFAULT_POLICY.signature_only_allowed,
    stamp_required: row?.stamp_required ?? DEFAULT_POLICY.stamp_required,
    forbid_text_only_fallback: row?.forbid_text_only_fallback ?? DEFAULT_POLICY.forbid_text_only_fallback,
    notes: row?.notes ?? null,
    updated_at: row?.updated_at ?? '',
  };
}

export async function fetchPolicyFor(type: DocumentType | string): Promise<DocTypePolicy> {
  const { data } = await supabase
    .from('document_type_policy' as never)
    .select('*')
    .eq('document_type' as never, type as never)
    .maybeSingle();
  const row = data as unknown as DocTypePolicy | null;
  return {
    document_type: type as DocumentType,
    signature_only_allowed: row?.signature_only_allowed ?? DEFAULT_POLICY.signature_only_allowed,
    stamp_required: row?.stamp_required ?? DEFAULT_POLICY.stamp_required,
    forbid_text_only_fallback: row?.forbid_text_only_fallback ?? DEFAULT_POLICY.forbid_text_only_fallback,
    notes: row?.notes ?? null,
    updated_at: row?.updated_at ?? '',
  };
}
