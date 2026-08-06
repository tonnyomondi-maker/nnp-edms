import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StampStageLayout {
  stage: 'HOD' | 'IQA_REVIEW' | 'DP';
  order: number;
  title: string;
  slot_height: number;
  sig_w: number;
  sig_h: number;
  stamp_size: number;
  title_size: number;
}

export interface StampLayout {
  id: string;
  name: string;
  version: number;
  is_active: boolean;
  header_title: string;
  stages: StampStageLayout[];
  created_at: string;
  updated_at: string;
}

export const DEFAULT_STAGES: StampStageLayout[] = [
  { stage: 'HOD', order: 1, title: '1. VERIFIED BY HEAD OF DEPARTMENT', slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
  { stage: 'IQA_REVIEW', order: 2, title: '2. VERIFIED BY INTERNAL QUALITY ASSURANCE', slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
  { stage: 'DP', order: 3, title: '3. APPROVED BY DEPUTY PRINCIPAL - ACADEMICS', slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
];

export function useStampLayouts() {
  return useQuery({
    queryKey: ['stamp-layouts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stamp_layouts' as never)
        .select('*')
        .order('created_at');
      if (error) throw error;
      return (data || []) as unknown as StampLayout[];
    },
  });
}

/** The layout the stamping function will use for the next approval. */
export function useActiveStampLayout() {
  const { data, ...rest } = useStampLayouts();
  const active = (data || []).find((l) => l.is_active) || null;
  return {
    ...rest,
    data: active,
    stages: (active?.stages?.length ? active.stages : DEFAULT_STAGES).slice().sort((a, b) => a.order - b.order),
    headerTitle: active?.header_title || 'DOCUMENT APPROVAL & VERIFICATION SHEET',
    label: active ? `${active.name} v${active.version}` : 'Standard 2026 v1',
  };
}

export function useSaveStampLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<StampLayout> & { name: string }) => {
      const payload = {
        ...(input.id ? { id: input.id } : {}),
        name: input.name,
        version: input.version ?? 1,
        is_active: input.is_active ?? false,
        header_title: input.header_title ?? 'DOCUMENT APPROVAL & VERIFICATION SHEET',
        stages: input.stages ?? DEFAULT_STAGES,
      };
      const { data, error } = await supabase
        .from('stamp_layouts' as never)
        .upsert(payload as never, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as StampLayout;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stamp-layouts'] }),
  });
}

export function useActivateStampLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error: clearErr } = await supabase
        .from('stamp_layouts' as never)
        .update({ is_active: false } as never)
        .neq('id', id);
      if (clearErr) throw clearErr;
      const { error } = await supabase
        .from('stamp_layouts' as never)
        .update({ is_active: true } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stamp-layouts'] }),
  });
}

export function useDeleteStampLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('stamp_layouts' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stamp-layouts'] }),
  });
}
