import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { clearSignedUrlCache } from '@/hooks/useSignedDocUrl';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';
import type { Database } from '@/integrations/supabase/types';

type DocumentStatus = Database['public']['Enums']['document_status'];
type DocumentType = Database['public']['Enums']['document_type'];
type SubmissionType = Database['public']['Enums']['submission_type'];

export type DocumentRow = Tables<'documents'>;

export function useMyDocuments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['documents', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .eq('trainer_id', user!.id)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useDocumentsByStatus(status: DocumentStatus) {
  return useQuery({
    queryKey: ['documents', 'status', status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .eq('status', status)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useDocumentsByDepartmentAndStatus(department: string, status: DocumentStatus) {
  return useQuery({
    queryKey: ['documents', 'dept', department, status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .eq('department', department)
        .eq('status', status)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!department,
  });
}

export function useAllDocuments() {
  return useQuery({
    queryKey: ['documents', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useDocumentsByDepartment(department: string) {
  return useQuery({
    queryKey: ['documents', 'dept-all', department],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .eq('department', department)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!department,
  });
}
export function useDocumentsByAssignment(assignmentId: string) {
  return useQuery({
    queryKey: ['documents', 'assignment', assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!assignmentId,
  });
}

const APPROVAL_STATUSES: DocumentStatus[] = ['HOD_APPROVED', 'DP_APPROVED', 'ARCHIVED'];

export interface ApprovalPlacement {
  page?: number | null;
  sigX?: number | null;
  sigY?: number | null;
  sigW?: number | null;
  sigH?: number | null;
  sigRot?: number | null;
  sigOpacity?: number | null;
  stampX?: number | null;
  stampY?: number | null;
  stampW?: number | null;
  stampH?: number | null;
  stampRot?: number | null;
  stampOpacity?: number | null;
  autofill?: boolean | null;
}

async function performApproval(
  docId: string,
  status: DocumentStatus,
  rejectionReason: string | undefined,
  userId: string,
  placement?: ApprovalPlacement | null,
  mode: 'IMAGE' | 'TEXT_ONLY' = 'IMAGE',
) {
  const updates: TablesUpdate<'documents'> = { status };

  if (status === 'REJECTED') {
    updates.rejection_reason = rejectionReason || 'Does not meet standards';
    const { data, error } = await supabase
      .from('documents').update(updates).eq('id', docId).select().single();
    if (error) throw error;
    return data;
  }

  if (!APPROVAL_STATUSES.includes(status)) {
    const { data, error } = await supabase
      .from('documents').update(updates).eq('id', docId).select().single();
    if (error) throw error;
    return data;
  }

  // Approval flow — fetch profile. Signature + stamp only required for IMAGE mode.
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('signature_url, stamp_url, full_name')
    .eq('user_id', userId)
    .single();
  if (profErr) throw profErr;
  if (mode === 'IMAGE' && (!profile?.signature_url || !profile?.stamp_url)) {
    throw new Error('Please upload your signature and stamp in Profile Settings before approving.');
  }

  const stage = status === 'HOD_APPROVED' ? 'HOD' : status === 'DP_APPROVED' ? 'DP' : 'IQA';

  // Burn signature + stamp (or text label) into PDF via edge function
  const { data: stampResp, error: stampErr } = await supabase.functions.invoke('stamp-document', {
    body: {
      documentId: docId,
      stage,
      signatureUrl: profile?.signature_url || '',
      stampUrl: profile?.stamp_url || '',
      approverName: profile?.full_name || '',
      placement: placement || null,
      mode,
    },
  });
  if (stampErr) throw new Error(stampErr.message || 'Failed to stamp document');
  const signedFileUrl = (stampResp as { signedFileUrl?: string })?.signedFileUrl;
  if (signedFileUrl) {
    updates.signed_file_url = signedFileUrl;
    clearSignedUrlCache(signedFileUrl);
  }

  if (status === 'HOD_APPROVED') {
    updates.hod_approved_at = new Date().toISOString();
    updates.hod_signature_url = profile.signature_url;
    updates.hod_stamp_url = profile.stamp_url;
    updates.hod_approved_by = userId;
    if (placement) {
      Object.assign(updates, {
        hod_sig_page: placement.page ?? null,
        hod_sig_x: placement.sigX ?? null,
        hod_sig_y: placement.sigY ?? null,
        hod_sig_w: placement.sigW ?? null,
        hod_sig_h: placement.sigH ?? null,
        hod_sig_rot: placement.sigRot ?? null,
        hod_sig_opacity: placement.sigOpacity ?? null,
        hod_stamp_page: placement.page ?? null,
        hod_stamp_x: placement.stampX ?? null,
        hod_stamp_y: placement.stampY ?? null,
        hod_stamp_w: placement.stampW ?? null,
        hod_stamp_h: placement.stampH ?? null,
        hod_stamp_rot: placement.stampRot ?? null,
        hod_stamp_opacity: placement.stampOpacity ?? null,
        hod_autofill: placement.autofill ?? true,
      });
    }
  } else if (status === 'DP_APPROVED') {
    updates.dp_approved_at = new Date().toISOString();
    updates.dp_signature_url = profile.signature_url;
    updates.dp_stamp_url = profile.stamp_url;
    updates.dp_approved_by = userId;
    if (placement) {
      Object.assign(updates, {
        dp_sig_page: placement.page ?? null,
        dp_sig_x: placement.sigX ?? null,
        dp_sig_y: placement.sigY ?? null,
        dp_sig_w: placement.sigW ?? null,
        dp_sig_h: placement.sigH ?? null,
        dp_sig_rot: placement.sigRot ?? null,
        dp_sig_opacity: placement.sigOpacity ?? null,
        dp_stamp_page: placement.page ?? null,
        dp_stamp_x: placement.stampX ?? null,
        dp_stamp_y: placement.stampY ?? null,
        dp_stamp_w: placement.stampW ?? null,
        dp_stamp_h: placement.stampH ?? null,
        dp_stamp_rot: placement.stampRot ?? null,
        dp_stamp_opacity: placement.stampOpacity ?? null,
        dp_autofill: placement.autofill ?? true,
      });
    }
  } else if (status === 'ARCHIVED') {
    updates.archived_at = new Date().toISOString();
    updates.iqa_signature_url = profile.signature_url;
    updates.iqa_stamp_url = profile.stamp_url;
    updates.iqa_archived_by = userId;
    if (placement) {
      Object.assign(updates, {
        iqa_sig_page: placement.page ?? null,
        iqa_sig_x: placement.sigX ?? null,
        iqa_sig_y: placement.sigY ?? null,
        iqa_sig_w: placement.sigW ?? null,
        iqa_sig_h: placement.sigH ?? null,
        iqa_sig_rot: placement.sigRot ?? null,
        iqa_sig_opacity: placement.sigOpacity ?? null,
        iqa_stamp_page: placement.page ?? null,
        iqa_stamp_x: placement.stampX ?? null,
        iqa_stamp_y: placement.stampY ?? null,
        iqa_stamp_w: placement.stampW ?? null,
        iqa_stamp_h: placement.stampH ?? null,
        iqa_stamp_rot: placement.stampRot ?? null,
        iqa_stamp_opacity: placement.stampOpacity ?? null,
        iqa_autofill: placement.autofill ?? true,
      });
    }
  }

  const { data, error } = await supabase
    .from('documents').update(updates).eq('id', docId).select().single();
  if (error) throw error;
  return data;
}

export function useUpdateDocumentStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ docId, status, rejectionReason, placement }: { docId: string; status: DocumentStatus; rejectionReason?: string; placement?: ApprovalPlacement | null }) => {
      if (!user) throw new Error('Not authenticated');
      return performApproval(docId, status, rejectionReason, user.id, placement);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useBulkUpdateDocumentStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ docIds, status, rejectionReason }: { docIds: string[]; status: DocumentStatus; rejectionReason?: string }) => {
      if (!user) throw new Error('Not authenticated');
      const results = await Promise.allSettled(
        docIds.map(id => performApproval(id, status, rejectionReason, user.id))
      );
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      return { succeeded, failed, firstErrorMessage: firstError ? (firstError.reason as Error).message : null };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useSubmitDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      file,
      assignmentId,
      documentType,
      submissionType,
      weekNumber,
      sessionIndex,
      sessionsPerWeek,
      department,
      unitCode,
      unitName,
      classCode,
      sessionYear,
      sessionTerm,
      termNumber,
      courseType,
      moduleNumber,
    }: {
      file: File;
      assignmentId?: string | null;
      documentType: DocumentType;
      submissionType: SubmissionType;
      weekNumber?: number;
      sessionIndex?: number;
      sessionsPerWeek?: number;
      department: string;
      unitCode: string;
      unitName?: string;
      classCode?: string;
      sessionYear: number;
      sessionTerm: 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC';
      termNumber?: number | null;
      courseType?: 'CYCLE' | 'MODULAR';
      moduleNumber?: number | null;
    }) => {
      const safeUnit = unitCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `${user!.id}/${sessionYear}_${sessionTerm}/${safeUnit}/${documentType}${weekNumber ? `_W${weekNumber}` : ''}${sessionIndex ? `_S${sessionIndex}` : ''}_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      const insertPayload: Record<string, unknown> = {
        assignment_id: assignmentId || null,
        trainer_id: user!.id,
        document_type: documentType,
        submission_type: submissionType,
        week_number: weekNumber || null,
        department,
        file_name: file.name,
        file_url: urlData.publicUrl,
        unit_code: unitCode,
        unit_name: unitName || null,
        class_code: classCode || null,
        session_year: sessionYear,
        session_term: sessionTerm,
        sessions_per_week: sessionsPerWeek || null,
        session_index: sessionIndex || null,
        term_number: courseType === 'MODULAR' ? null : (termNumber ?? null),
        course_type: courseType ?? 'CYCLE',
        module_number: courseType === 'MODULAR' ? (moduleNumber ?? null) : null,
      };

      const { data, error } = await supabase
        .from('documents')
        .insert(insertPayload as never)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useMyDocumentsBySession(year: number, term: 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC') {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['documents', 'mine-session', user?.id, year, term],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('trainer_id', user!.id)
        .eq('session_year' as never, year as never)
        .eq('session_term' as never, term as never)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
