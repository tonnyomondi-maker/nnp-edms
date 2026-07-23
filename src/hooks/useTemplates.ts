import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DocumentTemplate {
  id: string;
  document_type: string;
  department: string | null;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string | null;
  version: number;
  is_active: boolean;
  source_document_id: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useTemplates(filters?: { department?: string | null; documentType?: string | null; includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['templates', filters],
    queryFn: async () => {
      let q = supabase.from('document_templates' as never).select('*').order('document_type').order('version', { ascending: false });
      if (!filters?.includeInactive) q = q.eq('is_active', true);
      if (filters?.documentType) q = q.eq('document_type' as never, filters.documentType as never);
      if (filters?.department) q = q.or(`department.is.null,department.eq.${filters.department}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as DocumentTemplate[];
    },
  });
}

export function useUpsertTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<DocumentTemplate> & { document_type: string; title: string; file_path: string }) => {
      const { data, error } = await supabase.from('document_templates' as never).insert(input as never).select().single();
      if (error) throw error;
      return data as unknown as DocumentTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useToggleTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('document_templates' as never).update({ is_active } as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: row } = await supabase.from('document_templates' as never).select('file_path').eq('id', id).single();
      const filePath = (row as unknown as { file_path?: string })?.file_path;
      if (filePath) await supabase.storage.from('templates').remove([filePath]);
      const { error } = await supabase.from('document_templates' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export async function getTemplateSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('templates').createSignedUrl(filePath, 300);
  if (error || !data) throw error || new Error('Signed URL failed');
  return data.signedUrl;
}
