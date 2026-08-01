import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { clearSignedUrlCache } from '@/hooks/useSignedDocUrl';
import { assertSystemNotLocked } from '@/lib/systemLock';
import { fetchPolicyFor } from '@/hooks/useDocTypePolicy';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';
import type { Database } from '@/integrations/supabase/types';

type DocumentStatus = Database['public']['Enums']['document_status'];
type DocumentType = Database['public']['Enums']['document_type'];
type SubmissionType = Database['public']['Enums']['submission_type'];

export type DocumentRow = Tables<'documents'>;

/** Trainer identity attached client-side (documents has no FK embed to profiles). */
export type TrainerProfileLite = { full_name: string | null; pf_number: string | null; department: string | null };

async function attachTrainerProfiles<T extends { trainer_id: string }>(
  rows: T[],
): Promise<(T & { profiles: TrainerProfileLite | null })[]> {
  if (!rows.length) return rows as (T & { profiles: TrainerProfileLite | null })[];
  const ids = Array.from(new Set(rows.map((r) => r.trainer_id).filter(Boolean)));
  const { data } = await supabase
    .from('profiles')
    .select('user_id, full_name, pf_number, department')
    .in('user_id', ids);
  const map = new Map<string, TrainerProfileLite>(
    (data || []).map((p) => [p.user_id, { full_name: p.full_name, pf_number: p.pf_number, department: p.department }]),
  );
  return rows.map((r) => ({ ...r, profiles: map.get(r.trainer_id) ?? null }));
}

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
      return attachTrainerProfiles(data);
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
      return attachTrainerProfiles(data);
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
      return attachTrainerProfiles(data);
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
      return attachTrainerProfiles(data);
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

  // Approval flow — fetch profile + per-document-type policy. Policy is the
  // source of truth: it decides whether stamp is required and whether
  // signature-only is even allowed. Approver's preferred_stamp_mode and
  // legacy stamp_required only narrow within what policy permits.
  const [{ data: profile, error: profErr }, docMeta] = await Promise.all([
    supabase
      .from('profiles')
      .select('signature_url, stamp_url, full_name, stamp_required, preferred_stamp_mode')
      .eq('user_id', userId)
      .single(),
    supabase.from('documents').select('document_type').eq('id', docId).single(),
  ]);
  if (profErr) throw profErr;
  if (docMeta.error) throw docMeta.error;
  const policy = await fetchPolicyFor((docMeta.data as { document_type: string }).document_type);
  const profileAny = profile as unknown as { signature_url?: string; stamp_url?: string; full_name?: string; stamp_required?: boolean };
  // Effective stamp requirement = policy override OR (policy default AND approver opted in).
  const stampRequired = policy.stamp_required && !(policy.signature_only_allowed && profileAny?.stamp_required === false);
  if (mode === 'IMAGE') {
    if (!profileAny?.signature_url) {
      throw new Error('Please add a signature in Profile Settings (upload, draw, or type one) before approving.');
    }
    if (stampRequired && !profileAny?.stamp_url) {
      throw new Error(`A stamp is required to approve "${(docMeta.data as { document_type: string }).document_type}". Upload one in Profile Settings, or ask Super Admin to allow signature-only for this document type.`);
    }
  } else if (mode === 'TEXT_ONLY') {
    if (policy.forbid_text_only_fallback) {
      throw new Error(`Text-only approval is disabled for "${(docMeta.data as { document_type: string }).document_type}" — approver must have an uploaded signature or stamp.`);
    }
    if (policy.stamp_required && !policy.signature_only_allowed) {
      throw new Error(`Text-only quick approval is disabled for "${(docMeta.data as { document_type: string }).document_type}" — policy requires an embedded stamp.`);
    }
  }

  const stage = status === 'HOD_APPROVED' ? 'HOD' : status === 'DP_APPROVED' ? 'DP' : 'IQA';

  // Burn signature + stamp (or text label) into PDF via edge function
  const { data: stampResp, error: stampErr } = await supabase.functions.invoke('stamp-document', {
    body: {
      documentId: docId,
      stage,
      signatureUrl: profileAny?.signature_url || '',
      stampUrl: profileAny?.stamp_url || '',
      approverName: profileAny?.full_name || '',
      placement: placement || null,
      mode,
    },
  });
  if (stampErr || (stampResp as { error?: string } | null)?.error) {
    // Try to extract the real server error body so approvers see the actual reason
    // (e.g. "Policy requires an embedded stamp for this document type.")
    let msg = (stampResp as { error?: string } | null)?.error || stampErr?.message || 'Failed to stamp document';
    try {
      const ctx = (stampErr as unknown as { context?: { body?: ReadableStream | Response } })?.context;
      const body = ctx?.body as unknown as { text?: () => Promise<string> } | undefined;
      if (body?.text) {
        const text = await body.text();
        try { const parsed = JSON.parse(text); if (parsed?.error) msg = parsed.error; } catch { if (text) msg = text; }
      }
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  const signedFileUrl = (stampResp as { signedFileUrl?: string })?.signedFileUrl;
  if (signedFileUrl) {
    updates.signed_file_url = signedFileUrl;
    clearSignedUrlCache(signedFileUrl);
  }

  if (status === 'HOD_APPROVED') {
    const nowIso = new Date().toISOString();
    updates.hod_approved_at = nowIso;
    (updates as Record<string, unknown>).verified_by_hod_at = nowIso;
    updates.hod_signature_url = profileAny.signature_url || null;
    updates.hod_stamp_url = profileAny.stamp_url || null;
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
    const nowIso = new Date().toISOString();
    updates.dp_approved_at = nowIso;
    (updates as Record<string, unknown>).approved_by_dp_academics_at = nowIso;
    updates.dp_signature_url = profileAny.signature_url || null;
    updates.dp_stamp_url = profileAny.stamp_url || null;
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
    updates.iqa_signature_url = profileAny.signature_url || null;
    updates.iqa_stamp_url = profileAny.stamp_url || null;
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
    mutationFn: async ({ docId, status, rejectionReason, placement, mode }: { docId: string; status: DocumentStatus; rejectionReason?: string; placement?: ApprovalPlacement | null; mode?: 'IMAGE' | 'TEXT_ONLY' }) => {
      if (!user) throw new Error('Not authenticated');
      await assertSystemNotLocked(user.id);
      return performApproval(docId, status, rejectionReason, user.id, placement, mode);
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
    mutationFn: async ({ docIds, status, rejectionReason, mode }: { docIds: string[]; status: DocumentStatus; rejectionReason?: string; mode?: 'IMAGE' | 'TEXT_ONLY' }) => {
      if (!user) throw new Error('Not authenticated');
      await assertSystemNotLocked(user.id);
      // Bulk approvals default to TEXT_ONLY since there is no placement UI in bulk.
      const resolvedMode: 'IMAGE' | 'TEXT_ONLY' = mode ?? (status === 'REJECTED' ? 'IMAGE' : 'TEXT_ONLY');
      const results = await Promise.allSettled(
        docIds.map(id => performApproval(id, status, rejectionReason, user.id, null, resolvedMode))
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
      await assertSystemNotLocked(user?.id);
      const safeUnit = unitCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `${user!.id}/${sessionYear}_${sessionTerm}/${safeUnit}/${documentType}${weekNumber ? `_W${weekNumber}` : ''}${sessionIndex ? `_S${sessionIndex}` : ''}_${Date.now()}.pdf`;

      // Retry storage upload with exponential backoff so transient network
      // failures don't abort the submission.
      let uploadError: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { error } = await supabase.storage.from('documents').upload(filePath, file, { upsert: attempt > 1 });
        if (!error) { uploadError = null; break; }
        uploadError = error as unknown as Error;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
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

      // Best-effort mirror to Google Drive — never blocks the submission.
      // The edge function has its own retry + backoff.
      supabase.functions.invoke('gdrive-upload', { body: { documentId: data.id } })
        .catch(() => { /* logged server-side */ });

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

export function useRejectedDocument(docId: string | null) {
  return useQuery({
    queryKey: ['documents', 'rejected-detail', docId],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents').select('*').eq('id', docId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!docId,
  });
}
