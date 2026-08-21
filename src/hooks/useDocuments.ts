import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { clearSignedUrlCache } from '@/hooks/useSignedDocUrl';
import { assertSystemNotLocked } from '@/lib/systemLock';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import { fetchPolicyFor } from '@/hooks/useDocTypePolicy';
import { notifyDocumentEvent, stageForStatus, STAGE_ORDER, STAGE_LABEL, CLIENT_STAMP_VERSION } from '@/lib/notify';
import { SESSION_LEVEL_DOC_TYPES } from '@/lib/sessions';
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

const APPROVAL_STATUSES: DocumentStatus[] = ['HOD_APPROVED', 'IQA_REVIEWED', 'DP_APPROVED', 'ARCHIVED'];

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
    const { data: prev } = await supabase
      .from('documents')
      .select('status, trainer_id, document_type, file_name, rejection_count, version')
      .eq('id', docId)
      .single();
    const p = prev as {
      status?: string; trainer_id?: string; document_type?: string; file_name?: string;
      rejection_count?: number | null; version?: number | null;
    } | null;
    const stage = stageForStatus(p?.status || 'SUBMITTED');
    const nowIso = new Date().toISOString();
    const rejUpdates = {
      ...updates,
      rejection_count: (p?.rejection_count ?? 0) + 1,
      last_rejected_stage: stage,
      last_rejected_by: userId,
      last_rejected_at: nowIso,
      last_rejection_reason: updates.rejection_reason,
    } as TablesUpdate<'documents'>;
    const { data, error } = await supabase
      .from('documents').update(rejUpdates).eq('id', docId).select().single();
    if (error) throw error;

    // Immutable rejection history so every later approver can compare rounds.
    const { data: actor } = await supabase
      .from('profiles').select('full_name, email').eq('user_id', userId).maybeSingle();
    await supabase.from('document_rejections' as never).insert({
      document_id: docId,
      stage,
      reason: updates.rejection_reason,
      rejected_by: userId,
      rejected_by_name: actor?.full_name ?? null,
      rejected_by_email: actor?.email ?? null,
      document_version: p?.version ?? 1,
    } as never);

    if (p?.trainer_id) {
      await notifyDocumentEvent({
        userId: p.trainer_id,
        documentId: docId,
        kind: 'REJECTED',
        stage,
        title: `${p.document_type || 'Document'} rejected at stage ${STAGE_ORDER[stage]} (${STAGE_LABEL[stage]})`,
        message: `${p.file_name || 'Your document'} was rejected by ${actor?.full_name || STAGE_LABEL[stage]}. Edit and resubmit it from My Submissions. Approval sheet stamp version ${CLIENT_STAMP_VERSION}.`,
        note: updates.rejection_reason,
      });
    }
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

  const stage = status === 'HOD_APPROVED' ? 'HOD'
    : status === 'IQA_REVIEWED' ? 'IQA_REVIEW'
    : status === 'DP_APPROVED' ? 'DP' : 'IQA';

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
  } else if (status === 'IQA_REVIEWED') {
    const nowIso = new Date().toISOString();
    (updates as Record<string, unknown>).iqa_reviewed_at = nowIso;
    (updates as Record<string, unknown>).iqa_reviewed_by = userId;
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

  // Google Drive is the primary repository. After final approval/archival,
  // move the SAME Drive file from PENDING to APPROVED - ARCHIVE.
  if (status === 'DP_APPROVED' || status === 'ARCHIVED') {
    const { data: driveResp, error: driveErr } = await supabase.functions.invoke('gdrive-upload', {
      body: { documentId: docId, replace: true },
    });
    if (driveErr || (driveResp as { error?: string } | null)?.error) {
      throw new Error(await getEdgeFunctionErrorMessage(
        driveErr,
        driveResp,
        'Approval succeeded, but moving the document to the approved Google Drive archive failed. Retry the Drive finalization.'
      ));
    }
  }
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

export interface BulkSignResult {
  succeeded: number;
  failed: number;
  failures: { docId: string; message: string }[];
}

/**
 * Bulk "sign & approve": applies ONE placement (chosen once in PlacementModal)
 * to every selected document, sequentially so the stamp function is not
 * hammered, continuing past individual failures.
 */
export function useBulkApproveWithPlacement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      docIds, status, placement, onProgress,
    }: {
      docIds: string[];
      status: DocumentStatus;
      placement: ApprovalPlacement | null;
      onProgress?: (done: number, total: number) => void;
    }): Promise<BulkSignResult> => {
      if (!user) throw new Error('Not authenticated');
      await assertSystemNotLocked(user.id);
      const failures: { docId: string; message: string }[] = [];
      let succeeded = 0;
      for (let i = 0; i < docIds.length; i++) {
        try {
          await performApproval(docIds[i], status, undefined, user.id, placement, 'IMAGE');
          succeeded++;
        } catch (e) {
          failures.push({ docId: docIds[i], message: e instanceof Error ? e.message : 'Unknown error' });
        }
        onProgress?.(i + 1, docIds.length);
      }
      return { succeeded, failed: failures.length, failures };
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
      courseId,
      resubmitOf,
      resubmissionNote,

    }: {
      file: File;
      assignmentId?: string | null;
      documentType: DocumentType;
      submissionType: SubmissionType;
      weekNumber?: number;
      sessionIndex?: number;
      sessionsPerWeek?: number;
      department: string;
      unitCode?: string;
      unitName?: string;
      classCode?: string;
      sessionYear: number;
      sessionTerm: 'JAN_APR' | 'MAY_AUG' | 'SEP_DEC';
      termNumber?: number | null;
      courseType?: 'CYCLE' | 'MODULAR';
      moduleNumber?: number | null;
      courseId?: string | null;
      /** When set, the rejected document is updated in place instead of a new row. */
      resubmitOf?: string | null;
      /** Optional "what I changed" note shown to approvers on the rejection banner. */
      resubmissionNote?: string | null;
    }) => {


      await assertSystemNotLocked(user?.id);

      // Workload allocation is filed ONCE per training session for the whole
      // teaching load. Re-check right before writing so a double tap or a
      // stale page can't create a second one.
      if ((SESSION_LEVEL_DOC_TYPES as readonly string[]).includes(documentType)) {
        const { data: existing } = await supabase
          .from('documents')
          .select('id, status')
          .eq('trainer_id', user!.id)
          .eq('document_type', documentType as never)
          .eq('session_year' as never, sessionYear as never)
          .eq('session_term' as never, sessionTerm as never)
          .neq('status', 'REJECTED');
        const clash = (existing || []).filter((d) => d.id !== resubmitOf);
        if (clash.length > 0) {
          throw new Error(
            `${documentType} has already been filed for this training session. It covers every unit you teach — use "Edit & resubmit" if it was rejected.`,
          );
        }
      }

      // NNP ADMS storage policy: the PDF itself goes directly to Google Drive.
      // Supabase stores the document record, workflow state and Drive metadata;
      // it is no longer the primary PDF repository.
      const insertPayload: Record<string, unknown> = {
        assignment_id: assignmentId || null,
        trainer_id: user!.id,
        document_type: documentType,
        submission_type: submissionType,
        week_number: weekNumber || null,
        department,
        file_name: file.name,
        file_url: null,
        unit_code: unitCode || null,
        unit_name: unitName || null,
        class_code: classCode || null,
        session_year: sessionYear,
        session_term: sessionTerm,
        sessions_per_week: sessionsPerWeek || null,
        session_index: sessionIndex || null,
        term_number: courseType === 'MODULAR' ? null : (termNumber ?? null),
        course_type: courseType ?? 'CYCLE',
        module_number: courseType === 'MODULAR' ? (moduleNumber ?? null) : null,
        course_id: courseId ?? null,
      };

      if (resubmitOf) {
        // Continuity: keep one document record across rejection + resubmission so
        // the audit trail, notifications and timeline stay on a single history.
        // The superseded file is kept as previous_file_url (read-only) and the
        // version is bumped so approvers can see this is a corrected round.
        const { data: old } = await supabase
          .from('documents').select('file_url, gdrive_file_id, version').eq('id', resubmitOf).maybeSingle();
        const oldRow = old as { file_url?: string | null; gdrive_file_id?: string | null; version?: number | null } | null;
        const { data: updated, error: updErr } = await supabase
          .from('documents')
          .update({
            ...insertPayload,
            status: 'SUBMITTED',
            rejection_reason: null,
            return_note: null,
            returned_at: null,
            signed_file_url: null,
            submitted_at: new Date().toISOString(),
            version: (oldRow?.version ?? 1) + 1,
            previous_file_url: oldRow?.file_url ?? null,
            file_url: oldRow?.file_url ?? null,
            gdrive_file_id: oldRow?.gdrive_file_id ?? null,
            file_drive_id: oldRow?.gdrive_file_id ?? null,
            storage_tier: oldRow?.gdrive_file_id ? 'drive' : 'cloud',
            gdrive_sync_status: oldRow?.gdrive_file_id ? 'pending' : 'pending',
            resubmission_note: resubmissionNote?.trim() || null,
          } as never)
          .eq('id', resubmitOf)
          .select()
          .single();
        if (updErr) throw updErr;

        const form = new FormData();
        form.append('documentId', resubmitOf);
        form.append('replace', 'true');
        form.append('file', file, file.name);
        const { data: driveResp, error: driveErr } = await supabase.functions.invoke('gdrive-upload', { body: form });
        if (driveErr || (driveResp as { error?: string } | null)?.error) {
          // Restore the document to its prior rejected state so the trainer can retry.
          await supabase.from('documents').update({
            status: 'REJECTED',
            submitted_at: null,
            signed_file_url: null,
            file_url: oldRow?.file_url ?? null,
            gdrive_file_id: oldRow?.gdrive_file_id ?? null,
            file_drive_id: oldRow?.gdrive_file_id ?? null,
            storage_tier: oldRow?.gdrive_file_id ? 'drive' : 'cloud',
            gdrive_sync_status: 'failed',
          } as never).eq('id', resubmitOf);
          throw new Error(await getEdgeFunctionErrorMessage(driveErr, driveResp, 'Google Drive upload failed'));
        }
        return driveResp;
      }


      const { data, error } = await supabase
        .from('documents')
        .insert(insertPayload as never)
        .select()
        .single();
      if (error) throw error;

      // Upload the PDF directly to Google Drive/PENDING. The edge function
      // updates the same document row with its Drive file ID and storage tier.
      const form = new FormData();
      form.append('documentId', data.id);
      form.append('file', file, file.name);
      const { data: driveResp, error: driveErr } = await supabase.functions.invoke('gdrive-upload', { body: form });
      if (driveErr || (driveResp as { error?: string } | null)?.error) {
        // Clean up the orphaned document row so the trainer can retry without a ghost record.
        await supabase.from('documents').delete().eq('id', data.id);
        throw new Error(await getEdgeFunctionErrorMessage(driveErr, driveResp, 'Google Drive upload failed'));
      }

      return { ...data, ...(driveResp || {}) };
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
